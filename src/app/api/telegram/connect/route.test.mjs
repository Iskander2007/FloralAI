import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const telegramUrl = url(compile(await readFile(new URL("../../../../lib/telegram.ts", import.meta.url), "utf8")));
const aiUrl = url(compile(await readFile(new URL("../../../../lib/ai.ts", import.meta.url), "utf8")));
const nextUrl = url("export const NextResponse = { json: (body, init) => Response.json(body, init) };");
const serverUrl = url("export const createSupabaseServerClient = async () => globalThis.__telegramConnectTest.client;");
const adminUrl = url("export const createSupabaseAdminClient = () => globalThis.__telegramConnectTest.admin;");
const source = compile(await readFile(new URL("./route.ts", import.meta.url), "utf8"))
    .replaceAll('"next/server"', JSON.stringify(nextUrl)).replaceAll('"@/lib/telegram"', JSON.stringify(telegramUrl))
    .replaceAll('"@/lib/ai"', JSON.stringify(aiUrl))
    .replaceAll('"@/lib/supabase/server"', JSON.stringify(serverUrl)).replaceAll('"@/lib/supabase/admin"', JSON.stringify(adminUrl));
const api = await import(url(source));
const { decryptTelegramToken } = await import(telegramUrl);
const originalFetch = globalThis.fetch;
const envNames = ["TELEGRAM_TOKEN_ENCRYPTION_KEY", "NEXT_PUBLIC_APP_URL", "TELEGRAM_BOT_TOKEN"];
const originalEnv = Object.fromEntries(envNames.map((key) => [key, process.env[key]]));
const token = `12345:${"A".repeat(35)}`;
const request = (body = { token }, origin = "https://floral.example") => new Request("https://floral.example/api/telegram/connect", {
    method: "POST", headers: { origin }, body: JSON.stringify(body),
});

function setup({ user = { id: "verified-owner" }, access = true, saveError = null, webhookOk = true } = {}) {
    const context = { calls: [], writes: [], queries: [], network: [] };
    context.client = { auth: { getUser: async () => ({ data: { user }, error: null }) }, rpc: async () => ({ data: access, error: null }) };
    context.admin = {
        async rpc(name, args) { context.calls.push({ name, args }); return { data: { id: "shop-id", start_code: "a".repeat(32) }, error: saveError }; },
        from(table) {
            const query = { select(columns) { context.queries.push({ table, columns }); return query; },
                eq() { return query; }, update(data) { context.writes.push(data); return query; },
                single: async () => ({ data: { id: "shop-id" }, error: null }),
                maybeSingle: async () => ({ data: { bot_id: 12345, business_id: "shop-id", username: "florist_bot" }, error: null }) };
            return query;
        },
    };
    globalThis.__telegramConnectTest = context;
    globalThis.fetch = async (url, options) => {
        context.network.push({ url: String(url), body: JSON.parse(options.body) });
        return String(url).endsWith("/getMe")
            ? Response.json({ ok: true, result: { id: 12345, username: "florist_bot", is_bot: true } })
            : Response.json({ ok: webhookOk, result: webhookOk });
    };
    return context;
}
beforeEach(() => {
    process.env.TELEGRAM_TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
    process.env.NEXT_PUBLIC_APP_URL = "https://floral.example";
    process.env.TELEGRAM_BOT_TOKEN = `99999:${"B".repeat(35)}`;
});
after(() => {
    globalThis.fetch = originalFetch;
    delete globalThis.__telegramConnectTest;
    for (const key of envNames) { if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key]; }
});

test("personal connection verifies the owner, encrypts credentials, then configures and activates the bot", async () => {
    const context = setup();
    const response = await api.POST(request({ token, owner_id: "forged-owner" }));
    assert.equal(response.status, 200);
    const stored = context.calls[0].args;
    assert.equal(stored.p_owner_id, "verified-owner");
    assert.equal(stored.p_bot_id, 12345);
    assert.notEqual(stored.p_encrypted_token, token);
    assert.equal(decryptTelegramToken(stored.p_encrypted_token, process.env.TELEGRAM_TOKEN_ENCRYPTION_KEY, "verified-owner:12345"), token);
    assert.match(context.network[1].body.url, /\/api\/telegram\/webhook\?bot=12345$/);
    assert.match(context.network[1].body.secret_token, /^[a-f0-9]{64}$/);
    assert.deepEqual(context.writes, [{ active: true }]);
    assert.doesNotMatch(await response.text(), /AAA|encrypted_token|secret_token/);
});

test("unauthenticated, cross-origin and expired requests never reach Telegram or store credentials", async () => {
    for (const [options, origin, expected] of [[{ user: null }, "https://floral.example", 401], [{}, "https://attacker.example", 403], [{ access: false }, "https://floral.example", 402]]) {
        const context = setup(options);
        assert.equal((await api.POST(request({ token }, origin))).status, expected);
        assert.equal(context.calls.length, 0);
        assert.equal(context.network.length, 0);
    }
});

test("a bot already claimed elsewhere cannot have its webhook overwritten", async () => {
    const context = setup({ saveError: { code: "23505" } });
    assert.equal((await api.POST(request())).status, 409);
    assert.equal(context.network.length, 1);
    assert.equal(context.writes.length, 0);
});

test("Telegram rejection does not activate an unconfigured bot", async () => {
    const context = setup({ webhookOk: false });
    assert.equal((await api.POST(request())).status, 502);
    assert.equal(context.writes.length, 0);
});

test("connection status selects public fields only and prevents shared bot takeover", async () => {
    const context = setup();
    const response = await api.GET(request());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(context.queries[0].columns, "bot_id,username,business_id");
    process.env.TELEGRAM_BOT_TOKEN = token;
    assert.equal((await api.POST(request())).status, 409);
    assert.equal(context.calls.length, 0);
});
