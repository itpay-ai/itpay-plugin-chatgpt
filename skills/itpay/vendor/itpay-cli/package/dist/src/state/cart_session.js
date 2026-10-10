// Cart session for the V3 CLI with file persistence. Server cart is the
// business source of truth; this file is a handle cache plus an explicit local
// draft compatibility layer. Do not rely on local items for Service Execution
// or quota facts.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
export class CartSession {
    state;
    loadFailed = false;
    constructor(currency) {
        this.state = { currency, items: [] };
    }
    static loadFromFile(path, currency) {
        const session = new CartSession(currency);
        if (existsSync(path)) {
            try {
                const raw = readFileSync(path, "utf-8");
                const persisted = JSON.parse(raw);
                if (Array.isArray(persisted.items)) {
                    persisted.items.forEach((item) => {
                        if (item.catalogVariantID && item.offerID && item.quantity > 0) {
                            session.state.items.push({ ...item });
                        }
                    });
                }
                if (persisted.lastCartID)
                    session.state.lastCartID = persisted.lastCartID;
                if (persisted.lastCartItemID)
                    session.state.lastCartItemID = persisted.lastCartItemID;
                if (persisted.lastServiceExecutionID)
                    session.state.lastServiceExecutionID = persisted.lastServiceExecutionID;
                if (persisted.lastCheckoutID)
                    session.state.lastCheckoutID = persisted.lastCheckoutID;
                if (persisted.lastDisplayToken)
                    session.state.lastDisplayToken = persisted.lastDisplayToken;
                if (persisted.lastCheckoutURL)
                    session.state.lastCheckoutURL = persisted.lastCheckoutURL;
            }
            catch {
                session.state.items = [];
                session.loadFailed = true;
            }
        }
        return session;
    }
    saveToFile(path) {
        const toSave = {
            currency: this.state.currency,
            items: this.state.items.map((item) => ({ ...item })),
            ...(this.state.lastCartID ? { lastCartID: this.state.lastCartID } : {}),
            ...(this.state.lastCartItemID ? { lastCartItemID: this.state.lastCartItemID } : {}),
            ...(this.state.lastServiceExecutionID ? { lastServiceExecutionID: this.state.lastServiceExecutionID } : {}),
            ...(this.state.lastCheckoutID ? { lastCheckoutID: this.state.lastCheckoutID } : {}),
            ...(this.state.lastDisplayToken ? { lastDisplayToken: this.state.lastDisplayToken } : {}),
            ...(this.state.lastCheckoutURL ? { lastCheckoutURL: this.state.lastCheckoutURL } : {}),
        };
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
        writeFileSync(temporary, JSON.stringify(toSave, null, 2), { encoding: "utf-8", mode: 0o600 });
        chmodSync(temporary, 0o600);
        renameSync(temporary, path);
        chmodSync(path, 0o600);
    }
    add(item) {
        if (item.quantity <= 0) {
            throw new Error("quantity must be > 0");
        }
        const existing = this.state.items.find((i) => i.catalogVariantID === item.catalogVariantID && i.offerID === item.offerID);
        if (existing) {
            existing.quantity += item.quantity;
            if (item.input)
                existing.input = item.input;
            return;
        }
        this.state.items.push({ ...item });
    }
    remove(variantID, offerID) {
        const before = this.state.items.length;
        this.state.items = this.state.items.filter((i) => !(i.catalogVariantID === variantID && i.offerID === offerID));
        if (this.state.items.length === before) {
            throw new Error(`no line matches variant=${variantID} offer=${offerID}`);
        }
    }
    clear() {
        this.state = { currency: this.state.currency, items: [] };
    }
    show() {
        return JSON.parse(JSON.stringify(this.state));
    }
    toCreateCartRequest() {
        return {
            currency: this.state.currency,
            items: this.state.items.map((item) => ({
                catalog_item_id: item.catalogItemID,
                catalog_variant_id: item.catalogVariantID,
                offer_id: item.offerID,
                quantity: item.quantity,
                ...(item.input ? { input: item.input } : {}),
            })),
        };
    }
    rememberCheckout(input) {
        this.state.items = [];
        delete this.state.lastCartID;
        delete this.state.lastCartItemID;
        this.state.lastCheckoutID = input.checkoutID;
        this.state.lastDisplayToken = input.displayToken;
        this.state.lastCheckoutURL = input.checkoutURL;
        if (input.serviceExecutionID)
            this.state.lastServiceExecutionID = input.serviceExecutionID;
    }
    rememberServerCart(input) {
        this.state.items = [];
        this.state.lastCartID = input.cartID;
        delete this.state.lastCartItemID;
        delete this.state.lastServiceExecutionID;
        delete this.state.lastCheckoutID;
        delete this.state.lastDisplayToken;
        delete this.state.lastCheckoutURL;
        if (input.cartItemID)
            this.state.lastCartItemID = input.cartItemID;
        if (input.serviceExecutionID)
            this.state.lastServiceExecutionID = input.serviceExecutionID;
    }
    get lastCartID() {
        return this.state.lastCartID;
    }
    get lastCartItemID() {
        return this.state.lastCartItemID;
    }
    get lastServiceExecutionID() {
        return this.state.lastServiceExecutionID;
    }
    get lastCheckoutID() {
        return this.state.lastCheckoutID;
    }
    get lastDisplayToken() {
        return this.state.lastDisplayToken;
    }
    get currency() {
        return this.state.currency;
    }
    get stateLoadFailed() {
        return this.loadFailed;
    }
}
