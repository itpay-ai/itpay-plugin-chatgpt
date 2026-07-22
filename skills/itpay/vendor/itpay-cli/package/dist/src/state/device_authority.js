import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync, } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
const PROTECTED_PATHS = ["/v1/carts", "/v1/service-executions", "/v1/agent-instances", "/v1/orders", "/v1/refunds"];
export class DeviceAuthority {
    baseURL;
    backendKey;
    requestedAgentType;
    compatibilityHeaders;
    statePath;
    privateKeyPath;
    fetchImpl;
    pending;
    constructor(options) {
        this.baseURL = options.baseURL.replace(/\/$/, "");
        this.backendKey = normalizeBackendKey(options.baseURL);
        this.requestedAgentType = options.requestedAgentType;
        this.compatibilityHeaders = options.compatibilityHeaders;
        const root = resolve(homedir(), ".itpay-v3", "device");
        this.statePath = options.statePath ?? resolve(root, "identity.json");
        this.privateKeyPath = options.privateKeyPath ?? resolve(root, "device-private.pem");
        this.fetchImpl = (options.fetchImpl ?? globalThis.fetch).bind(globalThis);
    }
    async authorizationHeaders(input) {
        if (!PROTECTED_PATHS.some((prefix) => input.path.startsWith(prefix)))
            return {};
        const auth = await this.ensureAuthorization();
        const timestamp = new Date().toISOString();
        const jti = randomUUID();
        const bodyHash = sha256(input.body);
        const message = requestProofMessage(input.method, input.path, bodyHash, timestamp, jti);
        const signature = sign(null, Buffer.from(message), auth.privateKey).toString("base64");
        return {
            Authorization: `ItPayDevice ${auth.session.token}`,
            "X-ItPay-Agent-Instance-ID": auth.state.agentInstances[auth.agentType] ?? "",
            "X-ItPay-Agent-Type": auth.agentType,
            "X-ItPay-Agent-Timestamp": timestamp,
            "X-ItPay-Agent-Proof-JTI": jti,
            "X-ItPay-Agent-Body-SHA256": bodyHash,
            "X-ItPay-Agent-Signature": signature,
        };
    }
    async ensureAuthorization() {
        if (!this.pending) {
            this.pending = withFileLock(`${this.statePath}.lock`, () => this.prepareAuthorization()).finally(() => {
                this.pending = undefined;
            });
        }
        return this.pending;
    }
    async recoverAuthorization() {
        await withFileLock(`${this.statePath}.lock`, async () => {
            const state = this.readState();
            if (!state || !this.requestedAgentType)
                return;
            const registration = state.registrations[this.backendKey];
            if (!registration)
                return;
            delete registration.sessions[this.requestedAgentType];
            this.writeState(state);
        });
    }
    async recoverBackendReset() {
        return withFileLock(`${this.statePath}.lock`, async () => {
            const state = this.readState();
            const registration = state?.registrations[this.backendKey];
            if (!state || !registration)
                return { removed: false, agentTypes: [] };
            const agentTypes = Object.keys(registration.agentInstances).sort();
            delete state.registrations[this.backendKey];
            this.writeState(state);
            return { removed: true, agentTypes };
        });
    }
    async prepareAuthorization() {
        let state = this.readState() ?? emptyDeviceState();
        const agentType = this.requestedAgentType;
        if (!agentType) {
            throw new Error("agent type is required for ItPay commerce; pass --agent-type <type> or set ITPAY_AGENT_TYPE");
        }
        let privateKey = this.readPrivateKey();
        if (!privateKey) {
            const pair = generateKeyPairSync("ed25519");
            privateKey = pair.privateKey;
            this.writePrivateKey(pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
            state = emptyDeviceState();
        }
        let registration = state.registrations[this.backendKey];
        if (!registration && state.legacyRegistration) {
            try {
                await this.ensureRegistrationAgentType(state.legacyRegistration, agentType, privateKey, true);
                registration = state.legacyRegistration;
                delete state.legacyRegistration;
            }
            catch (error) {
                if (!canMovePastLegacyRegistration(error))
                    throw error;
            }
        }
        if (!registration) {
            registration = await this.enroll(agentType, privateKey);
        }
        state.registrations[this.backendKey] = registration;
        const session = await this.ensureRegistrationAgentType(registration, agentType, privateKey, false);
        this.writeState(state);
        return { state: registration, agentType, session, privateKey };
    }
    async ensureRegistrationAgentType(registration, agentType, privateKey, forceSession) {
        if (!registration.agentInstances[agentType]) {
            const existingType = firstAgentType(registration);
            if (!existingType)
                throw new Error("device has no registered agent instance");
            const existingSession = await this.ensureSession(registration, existingType, privateKey, forceSession);
            const registered = await this.signedJSON("/v1/agent-instances", { agent_type: agentType }, registration, existingType, existingSession, privateKey);
            registration.agentInstances[agentType] = registered.agent_instance_id;
        }
        return this.ensureSession(registration, agentType, privateKey, forceSession);
    }
    async enroll(agentType, privateKey) {
        const publicJWK = createPublicKey(privateKey).export({ format: "jwk" });
        if (!publicJWK.x)
            throw new Error("unable to export Ed25519 public key");
        const publicKey = Buffer.from(publicJWK.x, "base64url").toString("base64");
        const started = await this.publicJSON("/v1/agent-device-enrollments", { public_key: publicKey, agent_type: agentType });
        const proof = enrollmentProofMessage(started.agent_device_enrollment_id, started.challenge);
        const verified = await this.publicJSON(`/v1/agent-device-enrollments/${encodeURIComponent(started.agent_device_enrollment_id)}/verify`, { challenge: started.challenge, signature: sign(null, Buffer.from(proof), privateKey).toString("base64") });
        return {
            deviceID: verified.agent_device_id,
            deviceKeyID: verified.agent_device_key_id,
            quotaLineageID: verified.quota_lineage_id,
            agentInstances: { [verified.agent_type]: verified.agent_instance_id },
            sessions: {},
        };
    }
    async ensureSession(state, agentType, privateKey, force = false) {
        const existing = state.sessions[agentType];
        if (!force && existing && Date.parse(existing.expiresAt) > Date.now() + 60_000)
            return existing;
        const instanceID = state.agentInstances[agentType];
        if (!instanceID)
            throw new Error(`agent instance is not registered for ${agentType}`);
        const challenge = await this.publicJSON("/v1/agent-device-session-challenges", {
            agent_device_id: state.deviceID,
            agent_instance_id: instanceID,
        });
        const proof = deviceSessionProofMessage(challenge.agent_device_session_challenge_id, challenge.challenge);
        const verified = await this.publicJSON(`/v1/agent-device-session-challenges/${encodeURIComponent(challenge.agent_device_session_challenge_id)}/verify`, { challenge: challenge.challenge, signature: sign(null, Buffer.from(proof), privateKey).toString("base64") });
        const session = { token: verified.session_token, expiresAt: verified.expires_at };
        state.sessions[agentType] = session;
        return session;
    }
    async signedJSON(path, bodyValue, state, agentType, session, privateKey) {
        const body = JSON.stringify(bodyValue);
        const timestamp = new Date().toISOString();
        const jti = randomUUID();
        const bodyHash = sha256(body);
        const signature = sign(null, Buffer.from(requestProofMessage("POST", path, bodyHash, timestamp, jti)), privateKey).toString("base64");
        return this.fetchJSON(path, body, {
            Authorization: `ItPayDevice ${session.token}`,
            "X-ItPay-Agent-Instance-ID": state.agentInstances[agentType] ?? "",
            "X-ItPay-Agent-Type": agentType,
            "X-ItPay-Agent-Timestamp": timestamp,
            "X-ItPay-Agent-Proof-JTI": jti,
            "X-ItPay-Agent-Body-SHA256": bodyHash,
            "X-ItPay-Agent-Signature": signature,
        });
    }
    publicJSON(path, bodyValue) {
        return this.fetchJSON(path, JSON.stringify(bodyValue), {});
    }
    async fetchJSON(path, body, extraHeaders) {
        const response = await this.fetchImpl(this.baseURL + path, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json", ...this.compatibilityHeaders, ...extraHeaders },
            body,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok)
            throw new DeviceAuthorizationError(response.status, payload.code, payload.message || payload.code || `ItPay device request failed: ${response.status}`);
        return payload;
    }
    readState() {
        if (!existsSync(this.statePath))
            return undefined;
        try {
            const parsed = JSON.parse(readFileSync(this.statePath, "utf8"));
            if (parsed.schemaVersion === "itpay.device.v2")
                return parsed;
            if (parsed.schemaVersion === "itpay.device.v1") {
                const { schemaVersion: _, ...legacyRegistration } = parsed;
                return { ...emptyDeviceState(), legacyRegistration };
            }
            return undefined;
        }
        catch (error) {
            const stateError = asDeviceStateError(error, "read_state");
            if (stateError)
                throw stateError;
            return undefined;
        }
    }
    readPrivateKey() {
        if (!existsSync(this.privateKeyPath))
            return undefined;
        try {
            return createPrivateKey(readFileSync(this.privateKeyPath, "utf8"));
        }
        catch (error) {
            const stateError = asDeviceStateError(error, "read_private_key");
            if (stateError)
                throw stateError;
            return undefined;
        }
    }
    writeState(state) { atomicOwnerOnlyWrite(this.statePath, JSON.stringify(state, null, 2), "write_state"); }
    writePrivateKey(value) { atomicOwnerOnlyWrite(this.privateKeyPath, value, "write_private_key"); }
}
export class DeviceAuthorizationError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = "DeviceAuthorizationError";
    }
}
export class DeviceStateError extends Error {
    operation;
    causeCode;
    code = "device_state_unwritable";
    constructor(operation, causeCode) {
        super(`ItPay device state operation failed: ${operation} (${causeCode})`);
        this.operation = operation;
        this.causeCode = causeCode;
        this.name = "DeviceStateError";
    }
}
function emptyDeviceState() {
    return { schemaVersion: "itpay.device.v2", registrations: {} };
}
function firstAgentType(state) { return Object.keys(state.agentInstances)[0]; }
function canMovePastLegacyRegistration(error) {
    return error instanceof DeviceAuthorizationError && (error.code === "agent_device_revoked" || error.status === 404);
}
function normalizeBackendKey(value) {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
}
function sha256(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function enrollmentProofMessage(id, challenge) { return `itpay-device-enrollment/v1\n${id}\n${challenge}`; }
function deviceSessionProofMessage(id, challenge) { return `itpay-device-session/v1\n${id}\n${challenge}`; }
function requestProofMessage(method, path, bodyHash, timestamp, jti) { return ["itpay-agent-request/v1", method, path, bodyHash, timestamp, jti].join("\n"); }
function atomicOwnerOnlyWrite(path, value, operation) {
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        writeFileSync(temporary, value, { encoding: "utf8", mode: 0o600 });
        chmodSync(temporary, 0o600);
        renameSync(temporary, path);
        chmodSync(path, 0o600);
    }
    catch (error) {
        try {
            unlinkSync(temporary);
        }
        catch { /* best-effort cleanup */ }
        throw asDeviceStatePathError(error, operation) ?? error;
    }
}
async function withFileLock(path, run) {
    try {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    }
    catch (error) {
        throw asDeviceStatePathError(error, "prepare_lock") ?? error;
    }
    let acquired = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
        try {
            mkdirSync(path, { mode: 0o700 });
            acquired = true;
            break;
        }
        catch (error) {
            const code = error.code;
            if (code !== "EEXIST")
                throw asDeviceStateError(error, "acquire_lock") ?? error;
            try {
                if (Date.now() - statSync(path).mtimeMs > 30_000)
                    removeLock(path, "remove_stale_lock");
            }
            catch (statError) {
                if (statError.code !== "ENOENT") {
                    throw asDeviceStateError(statError, "inspect_lock") ?? statError;
                }
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }
    if (!acquired)
        throw new Error("timed out waiting for ItPay device identity lock");
    try {
        return await run();
    }
    finally {
        removeLock(path, "release_lock");
    }
}
function removeLock(path, operation) {
    try {
        if (statSync(path).isDirectory())
            rmdirSync(path);
        else
            unlinkSync(path);
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw asDeviceStateError(error, operation) ?? error;
    }
}
function asDeviceStateError(error, operation) {
    const code = error.code;
    return code === "EACCES" || code === "EPERM" || code === "EROFS" || code === "ENOTDIR" || code === "EISDIR"
        ? new DeviceStateError(operation, code)
        : undefined;
}
function asDeviceStatePathError(error, operation) {
    const code = error.code;
    return code === "EEXIST" ? new DeviceStateError(operation, code) : asDeviceStateError(error, operation);
}
