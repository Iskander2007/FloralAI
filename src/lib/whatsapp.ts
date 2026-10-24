import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type WhatsAppConfig = {
    appId: string; appSecret: string; configId: string; version: string;
    verifyToken: string; encryptionKey: string; coexistence: boolean;
};

export function getWhatsAppConfig(): WhatsAppConfig | null {
    const env = process.env;
    if (env.WHATSAPP_ENABLED !== "true") return null;
    const values = [env.META_APP_ID, env.META_APP_SECRET, env.META_WHATSAPP_CONFIG_ID,
        env.META_GRAPH_VERSION, env.WHATSAPP_WEBHOOK_VERIFY_TOKEN, env.WHATSAPP_TOKEN_ENCRYPTION_KEY];
    if (values.some((value) => !value)) return null;
    if (!/^\d+$/.test(env.META_APP_ID!) || !/^\d+$/.test(env.META_WHATSAPP_CONFIG_ID!)
        || !/^v\d+\.0$/.test(env.META_GRAPH_VERSION!) || !/^[a-f0-9]{64}$/i.test(env.WHATSAPP_TOKEN_ENCRYPTION_KEY!)) return null;
    return {
        appId: env.META_APP_ID!, appSecret: env.META_APP_SECRET!, configId: env.META_WHATSAPP_CONFIG_ID!,
        version: env.META_GRAPH_VERSION!, verifyToken: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN!,
        encryptionKey: env.WHATSAPP_TOKEN_ENCRYPTION_KEY!, coexistence: env.WHATSAPP_COEXISTENCE_ENABLED === "true",
    };
}

export const digestNonce = (value: string) => createHash("sha256").update(value).digest("hex");

export function safeEqual(a: string, b: string) {
    const left = Buffer.from(a), right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}

export function validWhatsAppSignature(body: Uint8Array, signature: string | null, secret: string) {
    if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
    return safeEqual(signature, `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
}

// Bind the ciphertext to the owner and phone so moving a token between rows fails authentication.
export function encryptWhatsAppToken(token: string, key: string, binding: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
    cipher.setAAD(Buffer.from(binding));
    const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptWhatsAppToken(value: string, key: string, binding: string) {
    const [version, iv, tag, ciphertext, extra] = value.split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext || extra) throw new Error("Invalid encrypted token");
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(binding));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export type WhatsAppIncoming = {
    id: string; phoneId: string; wabaId: string; from: string; text: string; timestamp: number;
};

const object = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function parseWhatsAppMessages(payload: unknown): WhatsAppIncoming[] {
    const root = object(payload);
    if (root?.object !== "whatsapp_business_account" || !Array.isArray(root.entry)) return [];
    const result: WhatsAppIncoming[] = [];
    for (const entry of root.entry) {
        const account = object(entry);
        if (typeof account?.id !== "string" || !/^\d+$/.test(account.id) || !Array.isArray(account.changes)) continue;
        for (const change of account.changes) {
            const item = object(change), value = object(item?.value), metadata = object(value?.metadata);
            // Delivery statuses, history imports and outbound echoes must never trigger replies.
            if (item?.field !== "messages" || value?.messaging_product !== "whatsapp"
                || typeof metadata?.phone_number_id !== "string" || !/^\d+$/.test(metadata.phone_number_id)
                || !Array.isArray(value.messages)) continue;
            for (const raw of value.messages) {
                const message = object(raw);
                if (typeof message?.id !== "string" || message.id.length > 500 || !message.id
                    || typeof message.from !== "string" || !/^\d{7,15}$/.test(message.from)
                    || typeof message.timestamp !== "string" || !/^\d{1,12}$/.test(message.timestamp)) continue;
                const text = message.type === "text" ? object(message.text)?.body : undefined;
                result.push({ id: message.id, from: message.from, wabaId: account.id, phoneId: metadata.phone_number_id,
                    timestamp: Number(message.timestamp), text: typeof text === "string" ? text.trim().slice(0, 4000) : "[Сообщение без текста]" });
            }
        }
    }
    return result;
}

export async function whatsAppGraph<T>(config: WhatsAppConfig, path: string, token: string, body?: unknown): Promise<T> {
    const response = await fetch(`https://graph.facebook.com/${config.version}/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: "no-store", signal: AbortSignal.timeout(12_000),
    });
    const result = await response.json();
    // Do not log Graph URLs, bodies or errors: they can contain customer tokens and phone numbers.
    if (!response.ok || result.error) throw new Error("WhatsApp API request failed");
    return result as T;
}
