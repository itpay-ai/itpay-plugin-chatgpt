import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
const PROTECTED_PATHS = ["/v1/agent-device-account-bindings", "/v1/carts", "/v1/service-executions", "/v1/agent-instances", "/v1/orders", "/v1/refunds", "/v1/me", "/v1/vault", "/v1/rail/phone-links"];
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
            this.pending = this.cachedAuthorization() ?? withFileLock(`${this.statePath}.lock`, () => this.prepareAuthorization());
            this.pending = this.pending.finally(() => {
                this.pending = undefined;
            });
        }
        return this.pending;
    }
    cachedAuthorization() {
        const agentType = this.requestedAgentType;
        if (!agentType)
            return undefined;
        const state = this.readState();
        const registration = state?.registrations[this.backendKey];
        const session = registration?.sessions[agentType];
        if (!registration?.agentInstances[agentType] || !session || Date.parse(session.expiresAt) <= Date.now() + 60_000)
            return undefined;
        const privateKey = this.readPrivateKey();
        return privateKey ? Promise.resolve({ state: registration, agentType, session, privateKey }) : undefined;
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
    repairLock() {
        return inspectAndRecoverLock(`${this.statePath}.lock`);
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
    async resetDeviceKey() {
        return withFileLock(`${this.statePath}.lock`, async () => {
            const state = this.readState();
            const removedBackends = state ? Object.keys(state.registrations).sort() : [];
            // Delete the key first: if the process dies before the state write, the
            // next run treats the missing key as a fresh install and completes the
            // reset itself; it can never pair a new key with stale registrations.
            if (existsSync(this.privateKeyPath)) {
                try {
                    unlinkSync(this.privateKeyPath);
                }
                catch (error) {
                    if (error.code !== "ENOENT") {
                        throw asDeviceStateError(error, "remove_private_key") ?? error;
                    }
                }
            }
            this.writeState(emptyDeviceState());
            return { removedBackends };
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
            // Persist an empty state before the new key ever reaches disk so a crash
            // can never pair the new key with registrations bound to the old one.
            // A crash between the two writes leaves either no key (fresh retry) or a
            // key with no registrations (the backend re-attaches to the existing
            // device instead of creating a duplicate).
            state = emptyDeviceState();
            this.writeState(state);
            this.writePrivateKey(pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
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
        let session;
        try {
            session = await this.ensureRegistrationAgentType(registration, agentType, privateKey, false);
        }
        catch (error) {
            if (!isUnknownDeviceRegistration(error))
                throw error;
            // The backend lost this registration (e.g. its identity store was
            // rebuilt). Drop the stale record and enroll once: the same key either
            // re-attaches to the surviving device or creates a fresh one.
            delete state.registrations[this.backendKey];
            registration = await this.enroll(agentType, privateKey);
            state.registrations[this.backendKey] = registration;
            session = await this.ensureRegistrationAgentType(registration, agentType, privateKey, false);
        }
        this.writeState(state);
        return { state: registration, agentType, session, privateKey };
    }
    async ensureRegistrationAgentType(registration, agentType, privateKey, forceSession) {
        if (!registration.agentInstances[agentType]) {
            const existingTypes = Object.keys(registration.agentInstances).sort();
            if (existingTypes.length === 0)
                throw new Error("device has no registered agent instance");
            let revokedError;
            for (const existingType of existingTypes) {
                try {
                    const existingSession = await this.ensureSession(registration, existingType, privateKey, forceSession);
                    const registered = await this.signedJSON("/v1/agent-instances", { agent_type: agentType }, registration, existingType, existingSession, privateKey);
                    registration.agentInstances[agentType] = registered.agent_instance_id;
                    break;
                }
                catch (error) {
                    if (!(error instanceof DeviceAuthorizationError) || error.code !== "agent_device_revoked")
                        throw error;
                    delete registration.sessions[existingType];
                    revokedError = error;
                }
            }
            if (!registration.agentInstances[agentType])
                throw revokedError ?? new Error("device has no active registered agent instance");
        }
        return this.ensureSession(registration, agentType, privateKey, forceSession);
    }
    async enroll(agentType, privateKey) {
        const publicJWK = createPublicKey(privateKey).export({ format: "jwk" });
        if (!publicJWK.x)
            throw new Error("unable to export Ed25519 public key");
        const publicKey = Buffer.from(publicJWK.x, "base64url").toString("base64");
        try {
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
        catch (error) {
            if (error instanceof DeviceAuthorizationError)
                error.enrollmentFailed = true;
            throw error;
        }
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
            signal: AbortSignal.timeout(15_000),
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
    enrollmentFailed = false;
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
export class DeviceLockBusyError extends Error {
    code = "device_lock_busy";
    constructor() {
        super("ItPay device identity is being updated by another process");
        this.name = "DeviceLockBusyError";
    }
}
function emptyDeviceState() {
    return { schemaVersion: "itpay.device.v2", registrations: {} };
}
function canMovePastLegacyRegistration(error) {
    return error instanceof DeviceAuthorizationError && (error.code === "agent_device_revoked" || error.status === 404);
}
function isUnknownDeviceRegistration(error) {
    return error instanceof DeviceAuthorizationError && (error.code === "agent_device_not_found" || error.status === 404);
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
    const ownerToken = `${process.pid}:${randomUUID()}`;
    let acquired = false;
    for (let attempt = 0; attempt < 800; attempt += 1) {
        try {
            writeFileSync(path, ownerToken, { encoding: "utf8", flag: "wx", mode: 0o600 });
            chmodSync(path, 0o600);
            acquired = true;
            break;
        }
        catch (error) {
            const code = error.code;
            if (code !== "EEXIST")
                throw asDeviceStateError(error, "acquire_lock") ?? error;
            inspectAndRecoverLock(path);
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }
    if (!acquired)
        throw new DeviceLockBusyError();
    try {
        return await run();
    }
    finally {
        releaseLock(path, ownerToken);
    }
}
function inspectAndRecoverLock(path) {
    let token;
    let age;
    try {
        const lockStat = statSync(path);
        age = Date.now() - lockStat.mtimeMs;
        token = lockStat.isDirectory() ? "" : readFileSync(path, "utf8");
    }
    catch (error) {
        if (error.code === "ENOENT")
            return "absent";
        throw asDeviceStateError(error, "inspect_lock") ?? error;
    }
    const ownerPID = /^(\d+):[0-9a-f-]+$/.exec(token)?.[1];
    if (ownerPID) {
        try {
            process.kill(Number(ownerPID), 0);
            return "active";
        }
        catch (error) {
            if (error.code !== "ESRCH")
                return "active";
        }
    }
    else if (age <= 30_000) {
        return "active";
    }
    // Recheck the exact owner before moving the lock; another process may have renewed it.
    try {
        if (token ? readFileSync(path, "utf8") !== token : !statSync(path).isDirectory())
            return "active";
    }
    catch (error) {
        if (error.code === "ENOENT")
            return "absent";
        throw asDeviceStateError(error, "inspect_lock") ?? error;
    }
    moveLockAside(path, "stale", "remove_stale_lock");
    return "recovered";
}
function releaseLock(path, ownerToken) {
    try {
        if (readFileSync(path, "utf8") !== ownerToken)
            return;
        moveLockAside(path, "released", "release_lock");
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw asDeviceStateError(error, "release_lock") ?? error;
    }
}
function moveLockAside(path, suffix, operation) {
    try {
        renameSync(path, `${path}.${suffix}`);
    }
    catch (error) {
        const code = error.code;
        if (code === "ENOENT")
            return;
        if (code === "EEXIST" || code === "ENOTEMPTY") {
            renameSync(path, `${path}.${suffix}.${randomUUID()}`);
            return;
        }
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
