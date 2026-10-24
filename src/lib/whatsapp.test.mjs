import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import ts from "typescript";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const lib = await import(moduleUrl(compile(await readFile(new URL("./whatsapp.ts", import.meta.url), "utf8"))));
const reply = await import(moduleUrl(compile(await readFile(new URL("./whatsapp-reply.ts", import.meta.url), "utf8"))
    .replaceAll('"@/lib/ai"', JSON.stringify(moduleUrl("export async function generateAIResponse() { throw new Error('Unexpected paid model call'); }")))));
const originalEnv = { ...process.env };
after(() => { process.env = originalEnv; });

test("WhatsApp token encryption authenticates the ciphertext, owner and phone number", () => {
    const key = "ab".repeat(32), secret = "not-a-real-meta-token", binding = "owner-a:phone-a";
    const encrypted = lib.encryptWhatsAppToken(secret, key, binding);
    assert.ok(!encrypted.includes(secret));
    assert.equal(lib.decryptWhatsAppToken(encrypted, key, binding), secret);
    assert.notEqual(encrypted, lib.encryptWhatsAppToken(secret, key, binding));
    assert.throws(() => lib.decryptWhatsAppToken(encrypted, key, "owner-b:phone-a"));
    assert.throws(() => lib.decryptWhatsAppToken(encrypted, key, "owner-a:phone-b"));
    assert.throws(() => lib.decryptWhatsAppToken(encrypted, "cd".repeat(32), binding));
    const parts = encrypted.split("."); parts[2] = Buffer.alloc(16).toString("base64url");
    assert.throws(() => lib.decryptWhatsAppToken(parts.join("."), key, binding));
});

test("webhook signatures verify the exact raw bytes, including non-ASCII content", () => {
    const body = Buffer.from('{"text":"Здравствуйте 🌷"}');
    const signature = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
    assert.equal(lib.validWhatsAppSignature(body, signature, "app-secret"), true);
    assert.equal(lib.validWhatsAppSignature(Buffer.concat([body, Buffer.from(" ")]), signature, "app-secret"), false);
    assert.equal(lib.validWhatsAppSignature(body, signature, "another-secret"), false);
    for (const invalid of [null, "", "sha1=abcd", "sha256=abcd"]) assert.equal(lib.validWhatsAppSignature(body, invalid, "app-secret"), false);
});

const entry = (waba, phone, messages, field = "messages") => ({ id: waba, changes: [{ field, value: {
    messaging_product: "whatsapp", metadata: { phone_number_id: phone }, messages,
} }] });
test("batched webhooks keep each WABA and phone binding and ignore echoes and statuses", () => {
    const msg = { id: "wamid.1", from: "77771234567", timestamp: "1792830000", type: "text", text: { body: "  Привет  " } };
    const messages = lib.parseWhatsAppMessages({ object: "whatsapp_business_account", entry: [
        entry("101", "201", [msg]), entry("102", "202", [{ ...msg, id: "wamid.2", type: "image" }]),
        entry("101", "201", [msg], "smb_message_echoes"), entry("101", "201", [msg], "history"),
        entry("101", "201", [{ ...msg, from: "../../../bad" }, { ...msg, timestamp: "no" }]),
    ] });
    assert.equal(messages.length, 2);
    assert.deepEqual(messages.map((m) => [m.wabaId, m.phoneId]), [["101", "201"], ["102", "202"]]);
    assert.equal(messages[0].text, "Привет");
    assert.equal(messages[1].text, "[Сообщение без текста]");
    for (const payload of [null, [], {}, { object: "page", entry: [entry("101", "201", [msg])] }]) assert.deepEqual(lib.parseWhatsAppMessages(payload), []);
});

test("WhatsApp stays unavailable until all server configuration is present and valid", () => {
    const config = { WHATSAPP_ENABLED: "true", META_APP_ID: "123", META_APP_SECRET: "test", META_WHATSAPP_CONFIG_ID: "456",
        META_GRAPH_VERSION: "v24.0", WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify", WHATSAPP_TOKEN_ENCRYPTION_KEY: "ab".repeat(32) };
    Object.assign(process.env, config);
    assert.equal(lib.getWhatsAppConfig().appId, "123");
    for (const [key, value] of Object.entries(config)) {
        process.env[key] = ""; assert.equal(lib.getWhatsAppConfig(), null, key); process.env[key] = value;
    }
    process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = "short"; assert.equal(lib.getWhatsAppConfig(), null);
    Object.assign(process.env, config);
    process.env.META_GRAPH_VERSION = "https://elsewhere"; assert.equal(lib.getWhatsAppConfig(), null);
});

const profile = { name: "Мастерская", category: "Other", description: "Ремонт обуви", location: "Абая, 12", hours: "10:00–19:00",
    phone: "+77771112233", services: ["Ремонт молнии — от 3000 ₸"], language: "Russian", tone: "Friendly" };
test("FAQ replies use saved small-business facts and never claim a booking was made", async () => {
    delete process.env.OPENAI_API_KEY;
    assert.equal((await reply.answerWhatsAppMessage("Где вы находитесь?", profile, [], [])).reply, profile.location);
    assert.equal((await reply.answerWhatsAppMessage("Ваш график", profile, [], [])).reply, profile.hours);
    assert.match((await reply.answerWhatsAppMessage("Цены", profile, [], [])).reply, /3000/);
    assert.match((await reply.answerWhatsAppMessage("Цены", profile, [{ name: "Товар А", price_kzt: 7000 }], [])).reply, /Товар А.*7.000/);
    assert.doesNotMatch((await reply.answerWhatsAppMessage("Запиши меня на завтра", profile, [], [])).reply, /запись.*создан|заказ.*сохран|демо/i);
});

test("requests for a human pause automation and non-text messages have a useful fallback", async () => {
    for (const language of ["Russian", "English", "Kazakh"]) {
        assert.equal((await reply.answerWhatsAppMessage("оператор", { ...profile, language }, [], [])).handoff, true);
    }
    const result = await reply.answerWhatsAppMessage("[Сообщение без текста]", profile, [], []);
    assert.equal(result.handoff, false); assert.match(result.reply, /текстовые/);
});
