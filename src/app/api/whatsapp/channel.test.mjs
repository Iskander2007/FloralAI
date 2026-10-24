import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import ts from "typescript";

const originalFetch = globalThis.fetch, originalEnv = { ...process.env };
const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^import "server-only";\r?\n/gm, "");
const source = async (file) => compile(await readFile(new URL(file, import.meta.url), "utf8"));
const next = url("export const NextResponse = { json: (body, init) => new Response(JSON.stringify(body), {...init, headers:{'content-type':'application/json', ...init?.headers}}) };");
const server = url("export async function createSupabaseServerClient() { return globalThis.__waTest.client; }");
const admin = url("export function createSupabaseAdminClient() { globalThis.__waTest.adminCalls++; return globalThis.__waTest.admin; }");
const business = url(await source("../../../lib/business.ts"));
const ai = url(await source("../../../lib/ai.ts"));
const whatsapp = url(await source("../../../lib/whatsapp.ts"));
const reply = url("export async function answerWhatsAppMessage(message, profile, products, history) { const c=globalThis.__waTest; c.answers.push({message,profile,products,history}); return {reply:profile.name+': '+products.map(p=>p.name).join(', '),handoff:message==='оператор'}; }");
const shared = url((await source("../../../lib/whatsapp-server.ts"))
    .replaceAll('"next/server"', JSON.stringify(next)).replaceAll('"@/lib/supabase/server"', JSON.stringify(server)).replaceAll('"@/lib/supabase/admin"', JSON.stringify(admin)));
const worker = url((await source("../../../lib/whatsapp-worker.ts"))
    .replaceAll('"@/lib/supabase/admin"', JSON.stringify(admin)).replaceAll('"@/lib/business"', JSON.stringify(business))
    .replaceAll('"@/lib/whatsapp"', JSON.stringify(whatsapp)).replaceAll('"@/lib/whatsapp-reply"', JSON.stringify(reply)));
async function route(file) {
    return import(url((await source(file)).replaceAll('"next/server"', JSON.stringify(next))
        .replaceAll('"@/lib/whatsapp"', JSON.stringify(whatsapp)).replaceAll('"@/lib/whatsapp-server"', JSON.stringify(shared))
        .replaceAll('"@/lib/business"', JSON.stringify(business)).replaceAll('"@/lib/supabase/admin"', JSON.stringify(admin))
        .replaceAll('"@/lib/ai"', JSON.stringify(ai))
        .replaceAll('"@/lib/whatsapp-worker"', JSON.stringify(worker))));
}
const setup = await route("./setup/route.ts"), connect = await route("./connect/route.ts"),
    webhook = await route("./webhook/route.ts"), inbox = await route("./inbox/route.ts"), retry = await route("./retry/route.ts");
const lib = await import(whatsapp);
const ownerA = "10000000-0000-4000-8000-000000000001", ownerB = "10000000-0000-4000-8000-000000000002";
const base = "https://floral.example/api/whatsapp/";
const profile = { name: "Магазин A", category: "Other", description: "Мастерская", location: "Алматы", hours: "10–19",
    phone: "+77771112233", language: "Russian", tone: "Friendly", services: [] };

function install({ user = ownerA, access = true, sendFails = false, registerFails = false } = {}) {
    Object.assign(process.env, { WHATSAPP_ENABLED: "true", META_APP_ID: "101", META_APP_SECRET: "test-secret", META_WHATSAPP_CONFIG_ID: "303",
        META_GRAPH_VERSION: "v24.0", WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-test", WHATSAPP_TOKEN_ENCRYPTION_KEY: "ab".repeat(32), WHATSAPP_RETRY_SECRET: "retry-test", WHATSAPP_COEXISTENCE_ENABLED: "false" });
    const ctx = { user, access, reads: [], mutations: [], graph: [], answers: [], sends: 0, adminCalls: 0, nextId: 100,
        tables: {
            whatsapp_connections: [], whatsapp_signup_attempts: [], whatsapp_chats: [], whatsapp_events: [],
            business_profiles: [{ owner_id: ownerA, profile }, { owner_id: ownerB, profile: { ...profile, name: "Чужой бизнес" } }],
            catalog_products: [{ owner_id: ownerA, id: "product-a", name: "Товар A", price_kzt: 1000, description: "" },
                { owner_id: ownerB, id: "product-b", name: "Чужой товар", price_kzt: 1, description: "" }],
        },
    };
    const query = (table) => {
        const filters = []; let method = "select", payload, options = {}, columns = "*", one = false, limit = Infinity, order;
        const q = {
            select(value = "*") { columns = value; return q; },
            eq(field, value) { filters.push((row) => row[field] === value); return q; },
            gt(field, value) { filters.push((row) => row[field] > value); return q; },
            in(field, values) { filters.push((row) => values.includes(row[field])); return q; },
            order(field, opts) { order = { field, ...opts }; return q; },
            limit(value) { limit = value; return q; },
            maybeSingle() { one = true; return q; }, single() { one = true; return q; },
            upsert(value, opts) { method = "upsert"; payload = value; options = opts; return q; },
            update(value) { method = "update"; payload = value; return q; },
            delete() { method = "delete"; return q; },
            then(resolve, reject) {
                try {
                    const rows = ctx.tables[table] ??= []; let data = rows.filter((row) => filters.every((match) => match(row)));
                    if (method === "select") ctx.reads.push({ table, columns, result: [...data] });
                    else ctx.mutations.push({ table, method, payload });
                    if (method === "upsert") {
                        data = [];
                        for (const record of Array.isArray(payload) ? payload : [payload]) {
                            const found = rows.find((row) => row[options.onConflict] === record[options.onConflict]);
                            if (table === "whatsapp_connections" && (rows.some((row) => row.phone_number_id === record.phone_number_id && row.owner_id !== record.owner_id)
                                || found && found.phone_number_id !== record.phone_number_id)) return Promise.resolve({ data: null, error: { code: "23505" } }).then(resolve, reject);
                            if (found) { if (!options.ignoreDuplicates) Object.assign(found, record); data.push(found); }
                            else { const row = { id: ++ctx.nextId, created_at: new Date().toISOString(), status: "pending", ...record }; rows.push(row); data.push(row); }
                        }
                    }
                    if (method === "update") data.forEach((row) => Object.assign(row, payload));
                    if (method === "delete") ctx.tables[table] = rows.filter((row) => !data.includes(row));
                    if (order) data.sort((a, b) => (a[order.field] < b[order.field] ? -1 : 1) * (order.ascending === false ? -1 : 1));
                    data = data.slice(0, limit).map((row) => columns === "*" ? { ...row } : Object.fromEntries(columns.split(",").map((key) => [key, row[key]])));
                    return Promise.resolve({ data: one ? data[0] ?? null : data, error: null }).then(resolve, reject);
                } catch (error) { return Promise.reject(error).then(resolve, reject); }
            },
        }; return q;
    };
    ctx.admin = { from: query, async rpc(name, args) {
        if (name === "business_has_paid_access") return { data: ctx.access, error: null };
        let chat = ctx.tables.whatsapp_chats.find((row) => row.connection_id === args.p_connection && row.customer_phone === args.p_customer);
        if (!chat) { chat = { connection_id: args.p_connection, customer_phone: args.p_customer, paused: false }; ctx.tables.whatsapp_chats.push(chat); }
        const events = ctx.tables.whatsapp_events.filter((row) => row.connection_id === args.p_connection && row.customer_phone === args.p_customer);
        if (name === "claim_whatsapp_turn") {
            if (!ctx.access) return { data: { outcome: "inactive" }, error: null };
            if (chat.lease_id) return { data: { outcome: "busy" }, error: null };
            if (chat.paused) { events.filter((e) => e.status === "pending").forEach((e) => { e.status = "ignored"; }); return { data: { outcome: "paused" }, error: null }; }
            const event = events.find((row) => ["pending", "ready"].includes(row.status));
            if (!event) return { data: { outcome: "empty" }, error: null };
            chat.lease_id = args.p_lease; return { data: { outcome: "claimed", event: { ...event } }, error: null };
        }
        const event = events.find((row) => row.id === args.p_event);
        if (name === "prepare_whatsapp_reply") {
            Object.assign(event, { status: "ready", reply: args.p_reply }); if (args.p_handoff) chat.paused = true;
        }
        if (name === "finish_whatsapp_turn") { if (args.p_outgoing) Object.assign(event, { status: "sent", outgoing_message_id: args.p_outgoing }); chat.lease_id = null; }
        return { data: true, error: null };
    } };
    ctx.client = { from: query, auth: { getUser: async () => ({ data: { user: ctx.user ? { id: ctx.user } : null }, error: null }) },
        rpc: async () => ({ data: ctx.access, error: null }) };
    globalThis.__waTest = ctx;
    globalThis.fetch = async (input, init) => {
        const path = new URL(input).pathname; ctx.graph.push({ path, body: init?.body });
        const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
        if (path.endsWith("/oauth/access_token")) return json({ access_token: "token-a" });
        if (path.endsWith("/debug_token")) return json({ data: { is_valid: true, app_id: "101", scopes: ["whatsapp_business_messaging", "whatsapp_business_management"] } });
        if (path.endsWith("/401")) return json({ id: "401" });
        if (path.endsWith("/phone_numbers")) return json({ data: [{ id: "501", display_phone_number: "+77771112233", verified_name: "Магазин A" }] });
        if (path.endsWith("/subscribed_apps")) return json({ success: true });
        if (path.endsWith("/register")) return registerFails ? json({ error: {} }, 400) : json({ success: true });
        if (path.endsWith("/messages")) {
            ctx.sends++; if (sendFails) return json({ error: {} }, 500);
            return json({ messages: [{ id: `outgoing-${ctx.sends}` }] });
        }
        return json({ error: {} }, 403);
    };
    return ctx;
}

function connection(ctx, owner = ownerA, phoneId = "501", id = "conn-a", wabaId = "401") {
    const row = { id, owner_id: owner, phone_number_id: phoneId, waba_id: wabaId, display_phone: "+77771112233",
        verified_name: "Магазин", active: true, connected_at: new Date().toISOString(), token_expires_at: null,
        token_ciphertext: lib.encryptWhatsAppToken("token-a", process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY, `${owner}:${phoneId}`) };
    ctx.tables.whatsapp_connections.push(row); return row;
}
const request = (path, method = "GET", body) => new Request(base + path, { method,
    headers: { origin: "https://floral.example", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
function incoming(id = "wamid.1", { phoneId = "501", wabaId = "401", from = "77770000000", text = "Привет", timestamp = Math.floor(Date.now() / 1000) } = {}) {
    return { id: wabaId, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: phoneId },
        messages: [{ id, from, type: "text", text: { body: text }, timestamp: String(timestamp) }] } }] };
}
function hook(entries, valid = true) {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: entries });
    const sig = createHmac("sha256", valid ? "test-secret" : "forged").update(body).digest("hex");
    return new Request(base + "webhook", { method: "POST", headers: { "x-hub-signature-256": `sha256=${sig}` }, body });
}
after(() => { globalThis.fetch = originalFetch; process.env = originalEnv; delete globalThis.__waTest; });

test("owner APIs reject anonymous and cross-origin callers before privileged reads", async () => {
    for (const handler of [setup.GET, setup.POST, setup.PATCH, connect.POST, inbox.GET, inbox.PATCH]) {
        const ctx = install({ user: null }); const response = await handler(request("setup", "POST", {}));
        assert.equal(response.status, 401); assert.equal(ctx.adminCalls, 0); assert.equal(ctx.reads.length, 0);
    }
    const ctx = install();
    const response = await setup.POST(new Request(base + "setup", { method: "POST", headers: { origin: "https://attacker.example" }, body: "{}" }));
    assert.equal(response.status, 403); assert.equal(ctx.adminCalls, 0);
});

test("setup shows only the verified owner's metadata, never credentials", async () => {
    const ctx = install(); connection(ctx); connection(ctx, ownerB, "502", "conn-b", "402");
    const response = await setup.GET(request("setup?owner_id=" + ownerB));
    const data = await response.json();
    assert.equal(data.connection.id, "conn-a");
    assert.equal(data.connection.token_ciphertext, undefined); assert.equal(data.connection.owner_id, undefined);
    assert.doesNotMatch(JSON.stringify(data), /token-a|test-secret|nonce_hash/);
});

test("subscription and saved business are required before starting signup", async () => {
    let ctx = install({ access: false });
    assert.equal((await setup.POST(request("setup", "POST", { mode: "cloud" }))).status, 402);
    assert.equal(ctx.mutations.length, 0);
    ctx = install(); ctx.tables.business_profiles = [];
    assert.equal((await setup.POST(request("setup", "POST", { mode: "cloud" }))).status, 409);
    assert.equal(ctx.mutations.length, 0);
});

test("a signup nonce cannot be used by another owner or replayed after completion", async () => {
    const ctx = install();
    const start = await setup.POST(request("setup", "POST", { mode: "cloud", owner_id: ownerB }));
    const data = await start.json(); assert.ok(data.nonce);
    assert.equal(ctx.tables.whatsapp_signup_attempts[0].owner_id, ownerA);
    assert.notEqual(ctx.tables.whatsapp_signup_attempts[0].nonce_hash, data.nonce);
    const body = { nonce: data.nonce, code: "meta-code", wabaId: "401", phoneId: "501", pin: "123456" };
    ctx.user = ownerB;
    assert.equal((await connect.POST(request("connect", "POST", body))).status, 409); assert.equal(ctx.graph.length, 0);
    ctx.user = ownerA;
    const result = await connect.POST(request("connect", "POST", body));
    assert.equal(result.status, 200);
    assert.equal(ctx.tables.whatsapp_connections[0].owner_id, ownerA); assert.equal(ctx.tables.whatsapp_connections[0].active, true);
    assert.doesNotMatch(JSON.stringify(await result.json()), /token-a|token_ciphertext|test-secret/);
    const calls = ctx.graph.length;
    assert.equal((await connect.POST(request("connect", "POST", body))).status, 409); assert.equal(ctx.graph.length, calls);
});

test("an unrelated phone or failed Meta registration never activates a number", async () => {
    for (const opts of [{ phoneId: "999" }, { registerFails: true, phoneId: "501" }]) {
        const ctx = install(opts); const start = await setup.POST(request("setup", "POST", { mode: "cloud" })); const { nonce } = await start.json();
        const result = await connect.POST(request("connect", "POST", { nonce, code: "meta-code", wabaId: "401", phoneId: opts.phoneId, pin: "123456" }));
        assert.equal(result.status, 502);
        assert.ok(ctx.tables.whatsapp_connections.every((row) => !row.active && !row.connected_at));
    }
});

test("coexistence is explicitly enabled and does not re-register an existing Business App number", async () => {
    const ctx = install();
    assert.equal((await setup.POST(request("setup", "POST", { mode: "coexistence" }))).status, 400);
    process.env.WHATSAPP_COEXISTENCE_ENABLED = "true";
    const start = await setup.POST(request("setup", "POST", { mode: "coexistence" })); const { nonce } = await start.json();
    const result = await connect.POST(request("connect", "POST", { nonce, code: "meta-code", wabaId: "401" }));
    assert.equal(result.status, 200); assert.equal(ctx.tables.whatsapp_connections[0].active, true);
    assert.ok(!ctx.graph.some((call) => call.path.endsWith("/register")));
});

test("webhook challenge and signature verification run before any storage access", async () => {
    const ctx = install();
    assert.equal(await (await webhook.GET(new Request(base + "webhook?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=12345"))).text(), "12345");
    assert.equal((await webhook.GET(new Request(base + "webhook?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=12345"))).status, 403);
    assert.equal((await webhook.POST(hook([incoming()], false))).status, 401);
    assert.equal(ctx.adminCalls, 0); assert.equal(ctx.reads.length, 0);
});

test("batched businesses use their own profiles and catalogs and successful deliveries deduplicate", async () => {
    const ctx = install(); connection(ctx); connection(ctx, ownerB, "502", "conn-b", "402");
    const batch = [incoming(), incoming("wamid.2", { phoneId: "502", wabaId: "402" })];
    assert.equal((await webhook.POST(hook(batch))).status, 200);
    assert.equal(ctx.sends, 2); assert.equal(ctx.answers.length, 2);
    assert.equal(ctx.answers[0].profile.name, "Магазин A"); assert.deepEqual(ctx.answers[0].products.map((p) => p.name), ["Товар A"]);
    assert.equal(ctx.answers[1].profile.name, "Чужой бизнес"); assert.deepEqual(ctx.answers[1].products.map((p) => p.name), ["Чужой товар"]);
    assert.equal((await webhook.POST(hook(batch))).status, 200); assert.equal(ctx.sends, 2); assert.equal(ctx.answers.length, 2);
});

test("failed transport retries the saved reply without regenerating a conversation turn", async () => {
    const ctx = install({ sendFails: true }); connection(ctx);
    assert.equal((await webhook.POST(hook([incoming()]))).status, 503);
    assert.equal(ctx.tables.whatsapp_events[0].status, "ready"); assert.equal(ctx.answers.length, 1);
    assert.equal((await webhook.POST(hook([incoming()]))).status, 503);
    assert.equal(ctx.answers.length, 1); assert.equal(ctx.tables.whatsapp_events.length, 1);
});

test("paused numbers, expired windows and mismatched WABAs do not send messages", async () => {
    const ctx = install(); const conn = connection(ctx); conn.active = false;
    assert.equal((await webhook.POST(hook([incoming()]))).status, 200); assert.equal(ctx.sends, 0);
    conn.active = true;
    assert.equal((await webhook.POST(hook([incoming("stale", { timestamp: Math.floor(Date.now() / 1000) - 90000 }), incoming("wrong", { wabaId: "999" })]))).status, 200);
    assert.equal(ctx.tables.whatsapp_events.length, 0); assert.equal(ctx.sends, 0);
});

test("a human request pauses the chat and later customer messages remain available to the owner", async () => {
    const ctx = install(); connection(ctx);
    assert.equal((await webhook.POST(hook([incoming("handoff", { text: "оператор" })]))).status, 200);
    assert.equal(ctx.sends, 1); assert.equal(ctx.tables.whatsapp_chats[0].paused, true);
    assert.equal((await webhook.POST(hook([incoming("after-handoff", { text: "Хочу уточнить заказ" })]))).status, 200);
    assert.equal(ctx.sends, 1); assert.equal(ctx.tables.whatsapp_events.length, 2);
    assert.equal(ctx.tables.whatsapp_events[1].content, "Хочу уточнить заказ");
});

test("expired workspace access cannot generate or send WhatsApp replies", async () => {
    const ctx = install({ access: false }); connection(ctx);
    assert.equal((await webhook.POST(hook([incoming()]))).status, 200);
    assert.equal(ctx.answers.length, 0); assert.equal(ctx.sends, 0);
});

test("inbox reads and human takeover cannot reach another owner's conversations", async () => {
    const ctx = install(); connection(ctx); connection(ctx, ownerB, "502", "conn-b", "402");
    ctx.tables.whatsapp_chats.push({ connection_id: "conn-b", customer_phone: "77778889999", paused: false });
    ctx.tables.whatsapp_events.push({ id: 1, connection_id: "conn-b", customer_phone: "77778889999", content: "Private", status: "sent" });
    const result = await inbox.GET(request("inbox?customer=77778889999&owner_id=" + ownerB));
    assert.deepEqual(await result.json(), { chats: [], messages: [] });
    assert.equal((await inbox.PATCH(request("inbox", "PATCH", { customer: "77778889999", paused: true, owner_id: ownerB }))).status, 404);
    assert.equal(ctx.tables.whatsapp_chats[0].paused, false);
});

test("recovery endpoint is inaccessible without its separate scheduler secret", async () => {
    const ctx = install();
    assert.equal((await retry.POST(request("retry", "POST", {}))).status, 401); assert.equal(ctx.adminCalls, 0);
});
