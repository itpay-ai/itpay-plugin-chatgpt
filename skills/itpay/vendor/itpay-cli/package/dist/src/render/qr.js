// QR helpers used by the terminal renderer. The CLI never invents a
// brand QR on its own — it consumes the brand URLs the V3 backend
// hands back (qr_png_url / preferred_qr_url / mobile_wallet_url).
// For `auth_qr` (provider authorization) the CLI is allowed to
// generate a local QR from the brand URL because no provider QR
// exists yet. For `payment_qr` the CLI must not regenerate the QR.
import QRCode from "qrcode";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
function terminalQRType(format) {
    return format === "utf8" ? "utf8" : "terminal";
}
export async function renderTerminalQR(url, format) {
    return QRCode.toString(url, {
        type: format === "unicode" ? "utf8" : terminalQRType(format),
        small: true,
        errorCorrectionLevel: "L",
    });
}
export async function writeLocalPNG(url) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "itpay-v3-"));
    const filePath = path.join(dir, `itpay-${randomUUID()}.png`);
    await QRCode.toFile(filePath, url, {
        type: "png",
        errorCorrectionLevel: "M",
        margin: 2,
        width: 512,
    });
    return { filePath, mimeType: "image/png" };
}
