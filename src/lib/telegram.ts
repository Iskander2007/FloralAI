import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export function telegramEncryptionKey() {
    const key = process.env.TELEGRAM_TOKEN_ENCRYPTION_KEY;
    return key && /^[a-f0-9]{64}$/i.test(key) ? key : null;
}

export function encryptTelegramToken(token: string, key: string, binding: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
    cipher.setAAD(Buffer.from(`telegram:${binding}`));
    const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptTelegramToken(value: string, key: string, binding: string) {
    const parts = value.split(".");
    if (parts.length !== 3) throw new Error("Invalid Telegram credential");
    const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
    decipher.setAAD(Buffer.from(`telegram:${binding}`));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

// Stable across reconnects so a failed setup attempt does not invalidate a working webhook secret.
export function personalTelegramSecret(key: string, ownerId: string, botId: number | string) {
    return createHmac("sha256", Buffer.from(key, "hex")).update(`telegram-webhook:${ownerId}:${botId}`).digest("hex");
}

export async function telegramApi<T>(token: string, method: string, body?: unknown): Promise<T> {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(10_000), cache: "no-store",
    });
    const result = await response.json() as { ok?: boolean; result?: T };
    if (!response.ok || !result.ok || result.result === undefined) throw new Error("Telegram request failed");
    return result.result;
}
