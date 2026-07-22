import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
export class OperationJournal {
    path;
    constructor(path) {
        this.path = path;
    }
    async getOrCreate(operationKey) {
        return withFileLock(`${this.path}.lock`, async () => {
            const state = this.read();
            const existing = state.operations[operationKey];
            if (existing)
                return existing.id;
            const id = `op_${randomUUID().replaceAll("-", "")}`;
            state.operations[operationKey] = { id, createdAt: new Date().toISOString() };
            atomicOwnerOnlyWrite(this.path, JSON.stringify(state, null, 2));
            return id;
        });
    }
    read() {
        if (existsSync(this.path)) {
            try {
                const parsed = JSON.parse(readFileSync(this.path, "utf8"));
                if (parsed.schemaVersion === "itpay.operations.v1" && parsed.operations)
                    return parsed;
            }
            catch {
                // A malformed local cache is replaced; server facts remain authoritative.
            }
        }
        return { schemaVersion: "itpay.operations.v1", operations: {} };
    }
}
function atomicOwnerOnlyWrite(path, value) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, value, { encoding: "utf8", mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
    chmodSync(path, 0o600);
}
async function withFileLock(path, run) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    let descriptor;
    for (let attempt = 0; attempt < 200; attempt += 1) {
        try {
            descriptor = openSync(path, "wx", 0o600);
            break;
        }
        catch (error) {
            if (error.code !== "EEXIST")
                throw error;
            try {
                if (Date.now() - statSync(path).mtimeMs > 30_000)
                    unlinkSync(path);
            }
            catch (statError) {
                if (statError.code !== "ENOENT")
                    throw statError;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }
    if (descriptor === undefined)
        throw new Error("timed out waiting for ItPay operation journal lock");
    try {
        return await run();
    }
    finally {
        closeSync(descriptor);
        try {
            unlinkSync(path);
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
    }
}
