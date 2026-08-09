export class HttpTransportError extends Error {
    code;
    attempts;
    causeCode;
    retryable = true;
    constructor(code, attempts, causeCode, cause) {
        const suffix = attempts > 1 ? ` after ${attempts} attempts` : "";
        super(`${transportMessage(code)} before a complete HTTP response was received${suffix}`, { cause });
        this.code = code;
        this.attempts = attempts;
        this.causeCode = causeCode;
        this.name = "HttpTransportError";
    }
}
export function asTransientTransportError(error, attempts) {
    if (isAbort(error))
        return undefined;
    const causeCode = findCauseCode(error);
    const code = causeCode ? classifyCauseCode(causeCode) : classifyFetchFailure(error);
    return code ? new HttpTransportError(code, attempts, causeCode, error) : undefined;
}
function classifyCauseCode(code) {
    switch (code) {
        case "ECONNRESET":
            return "network_connection_reset";
        case "ETIMEDOUT":
        case "UND_ERR_CONNECT_TIMEOUT":
        case "UND_ERR_HEADERS_TIMEOUT":
        case "UND_ERR_BODY_TIMEOUT":
            return "network_timeout";
        case "EAI_AGAIN":
            return "network_dns_temporary";
        case "ENETUNREACH":
        case "EHOSTUNREACH":
            return "network_unreachable";
        case "ECONNREFUSED":
            return "network_connection_refused";
        case "UND_ERR_SOCKET":
            return "network_socket_error";
        default:
            return undefined;
    }
}
function classifyFetchFailure(error) {
    return error instanceof TypeError && error.message === "fetch failed"
        ? "network_transport_failed"
        : undefined;
}
function findCauseCode(error) {
    const seen = new Set();
    let current = error;
    while (current && typeof current === "object" && !seen.has(current)) {
        seen.add(current);
        const code = current.code;
        if (typeof code === "string" && code !== "")
            return code;
        current = current.cause;
    }
    return undefined;
}
function isAbort(error) {
    return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}
function transportMessage(code) {
    switch (code) {
        case "network_connection_reset":
            return "network connection was reset";
        case "network_timeout":
            return "network connection timed out";
        case "network_dns_temporary":
            return "DNS lookup was temporarily unavailable";
        case "network_unreachable":
            return "network was unreachable";
        case "network_connection_refused":
            return "network connection was refused";
        case "network_socket_error":
            return "network socket failed";
        case "network_transport_failed":
            return "network transport failed";
    }
}
