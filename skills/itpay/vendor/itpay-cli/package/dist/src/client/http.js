// Thin HTTP client for V3 backend. Keep this file boring on purpose:
// no retries, no SDK abstractions, no business logic. Higher layers
// own semantics (e.g. CLI commands, frontend feature hooks).
export class HttpError extends Error {
    status;
    code;
    payload;
    constructor(status, payload, fallbackMessage) {
        super(payload?.message || fallbackMessage);
        this.status = status;
        this.code = payload?.code || "unknown_error";
        this.payload = payload;
    }
}
export class HttpClient {
    baseURL;
    fetchImpl;
    defaultHeaders;
    requestAuthorizer;
    recoverAuthorization;
    constructor(config) {
        this.baseURL = config.baseURL.replace(/\/$/, "");
        this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
        this.defaultHeaders = {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(config.defaultHeaders ?? {}),
        };
        this.requestAuthorizer = config.requestAuthorizer;
        this.recoverAuthorization = config.recoverAuthorization;
    }
    async request(path, options = {}) {
        const url = path.startsWith("http") ? path : this.baseURL + path;
        const method = options.method ?? "GET";
        const body = options.body !== undefined ? JSON.stringify(options.body) : "";
        const requestPath = new URL(url).pathname + new URL(url).search;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const headers = { ...this.defaultHeaders };
            if (this.requestAuthorizer) {
                Object.assign(headers, await this.requestAuthorizer({ method, path: requestPath, body }));
            }
            if (options.bearer)
                headers.Authorization = `Bearer ${options.bearer}`;
            if (options.idempotencyKey)
                headers["Idempotency-Key"] = options.idempotencyKey;
            const response = await this.fetchImpl(url, {
                method,
                headers,
                ...(options.body !== undefined ? { body } : {}),
                ...(options.signal ? { signal: options.signal } : {}),
            });
            const text = await response.text();
            const parsed = text.length > 0 ? safeParseJson(text) : undefined;
            if (response.ok)
                return parsed;
            const error = new HttpError(response.status, parsed, `HTTP ${response.status}`);
            if (attempt === 0 && error.status === 401 && error.code === "agent_device_session_required" && this.recoverAuthorization) {
                await this.recoverAuthorization();
                continue;
            }
            throw error;
        }
        throw new Error("unreachable HTTP retry state");
    }
    get(path, options = {}) {
        return this.request(path, { ...options, method: "GET" });
    }
    post(path, body, options = {}) {
        return this.request(path, { ...options, method: "POST", body });
    }
    delete(path, options = {}) {
        return this.request(path, { ...options, method: "DELETE" });
    }
}
function safeParseJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return undefined;
    }
}
