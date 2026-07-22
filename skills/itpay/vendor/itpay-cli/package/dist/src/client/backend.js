// V3 endpoint wrappers. One function per route family; one file per domain.
// Keep parameter shapes aligned with the typed request DTOs in ./types.ts.
export class BackendClient {
    http;
    constructor(http) {
        this.http = http;
    }
    readyz() {
        return this.http.get("/v1/readyz");
    }
    compatibility() {
        return this.http.get("/v1/platform/compatibility");
    }
    // --- Catalog ---
    getCatalogManifest() {
        return this.http.get("/v1/catalog/manifest");
    }
    // --- Cart ---
    createCart(input) {
        return this.http.post("/v1/carts", input);
    }
    getCart(cartID) {
        return this.http.get(`/v1/carts/${encodeURIComponent(cartID)}`);
    }
    addCartItem(cartID, input) {
        return this.http.post(`/v1/carts/${encodeURIComponent(cartID)}/items`, input);
    }
    removeCartItem(cartID, cartItemID) {
        return this.http.delete(`/v1/carts/${encodeURIComponent(cartID)}/items/${encodeURIComponent(cartItemID)}`);
    }
    abandonCart(cartID) {
        return this.http.delete(`/v1/carts/${encodeURIComponent(cartID)}`);
    }
    // --- Checkout ---
    createCheckout(input, idempotencyKey) {
        return this.http.post("/v1/checkouts", input, idempotencyKey ? { idempotencyKey } : undefined);
    }
    getCheckoutPresentation(checkoutID, displayToken) {
        const qs = new URLSearchParams({ display_token: displayToken });
        return this.http.get(`/v1/checkouts/${encodeURIComponent(checkoutID)}/presentation?${qs}`);
    }
    // --- Payment intents ---
    createPaymentIntent(checkoutID, input) {
        return this.http.post(`/v1/checkouts/${encodeURIComponent(checkoutID)}/payment-intents`, input);
    }
    // --- SSE streaming ---
    streamCheckoutEvents(checkoutID, displayToken, onEvent, signal) {
        const qs = new URLSearchParams({ display_token: displayToken });
        const url = `${this.http.baseURL}/v1/checkouts/${encodeURIComponent(checkoutID)}/events?${qs}`;
        return streamSSE(url, onEvent, signal);
    }
    // --- Orders ---
    getOrder(orderID) {
        return this.http.get(`/v1/orders/${encodeURIComponent(orderID)}`);
    }
    getOrderDeliveryAccess(orderID) {
        return this.http.get(`/v1/orders/${encodeURIComponent(orderID)}/delivery-access`);
    }
    listAccountOrders(limit, status, bearer) {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (status) {
            qs.set("status", status);
        }
        return this.http.get(`/v1/me/orders?${qs}`, bearer ? { bearer } : {});
    }
    // --- Refund ---
    createRefund(orderID, input, bearer, idempotencyKey) {
        const options = { ...(bearer ? { bearer } : {}), ...(idempotencyKey ? { idempotencyKey } : {}) };
        return this.http.post(`/v1/orders/${encodeURIComponent(orderID)}/refunds`, input, options);
    }
    listOrderRefunds(orderID) {
        return this.http.get(`/v1/orders/${encodeURIComponent(orderID)}/refunds`);
    }
    getRefund(refundRequestID) {
        return this.http.get(`/v1/refunds/${encodeURIComponent(refundRequestID)}`);
    }
    cancelRefund(refundRequestID, reason = "buyer_cancelled") {
        return this.http.post(`/v1/refunds/${encodeURIComponent(refundRequestID)}/cancel`, { reason });
    }
    // --- Service Execution ---
    startServiceExecution(input) {
        return this.http.post("/v1/service-executions", input);
    }
    invokeServiceCapability(serviceExecutionID, capabilityID, input) {
        return this.http.post(`/v1/service-executions/${encodeURIComponent(serviceExecutionID)}/capabilities/${encodeURIComponent(capabilityID)}/invoke`, input);
    }
    recordServiceExecutionAction(serviceExecutionID, input) {
        return this.http.post(`/v1/service-executions/${encodeURIComponent(serviceExecutionID)}/actions`, input);
    }
    createServiceExecutionCheckout(serviceExecutionID, input) {
        return this.http.post(`/v1/service-executions/${encodeURIComponent(serviceExecutionID)}/checkout`, input);
    }
    prepareServiceQuote(serviceExecutionID, input) {
        return this.http.post(`/v1/service-executions/${encodeURIComponent(serviceExecutionID)}/quotes`, input);
    }
    getServiceExecution(serviceExecutionID) {
        return this.http.get(`/v1/service-executions/${encodeURIComponent(serviceExecutionID)}`);
    }
    listServiceExecutions(limit = 50) {
        return this.http.get(`/v1/service-executions?limit=${limit}`);
    }
    listServiceExecutionEvents(serviceExecutionID, afterSequence = 0, limit = 50) {
        const query = new URLSearchParams({
            after_sequence: String(afterSequence),
            limit: String(limit),
        });
        return this.http.get(`/v1/service-executions/${encodeURIComponent(serviceExecutionID)}/events?${query}`);
    }
    getGrantedServiceResult(serviceExecutionID) {
        return this.http.get(`/v1/service-executions/${encodeURIComponent(serviceExecutionID)}/granted-result`);
    }
}
// --- SSE streaming helper ---
async function streamSSE(url, onEvent, signal) {
    const response = await fetch(url, {
        headers: { Accept: "text/event-stream" },
        signal,
    });
    if (!response.ok) {
        const text = await response.text();
        let msg = `SSE stream failed: HTTP ${response.status}`;
        try {
            const parsed = JSON.parse(text);
            msg = parsed.message || parsed.code || msg;
        }
        catch { }
        throw new Error(msg);
    }
    if (!response.body) {
        throw new Error("SSE stream: no response body");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            let currentEvent = {};
            for (const line of lines) {
                if (line === "") {
                    if (currentEvent.type && currentEvent.payload) {
                        onEvent(currentEvent);
                    }
                    currentEvent = {};
                    continue;
                }
                if (line.startsWith("event: ")) {
                    currentEvent.type = line.slice(7);
                }
                else if (line.startsWith("data: ")) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        currentEvent.type = currentEvent.type || data.event_type;
                        currentEvent.aggregateType = data.aggregate_type;
                        currentEvent.aggregateId = data.aggregate_id;
                        currentEvent.sequence = data.sequence;
                        currentEvent.payload = data;
                    }
                    catch { }
                }
            }
        }
    }
    finally {
        reader.releaseLock();
    }
}
