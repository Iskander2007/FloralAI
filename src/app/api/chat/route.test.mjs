import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import ts from "typescript";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const transpile = (source) => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const businessUrl = moduleUrl(transpile(await readFile(new URL("../../../lib/business.ts", import.meta.url), "utf8")));
const salesUrl = moduleUrl(transpile(await readFile(new URL("../../../lib/sales-assistant.ts", import.meta.url), "utf8")));
const nextUrl = moduleUrl("export const NextResponse = {json: (body, init) => new Response(JSON.stringify(body), {...init, headers: {'content-type': 'application/json'}})};");
const serverUrl = moduleUrl("export const createSupabaseServerClient = async () => globalThis.__floralOwnerPreviewTest.client;");
const source = transpile(await readFile(new URL("./route.ts", import.meta.url), "utf8"))
    .replaceAll('"next/server"', JSON.stringify(nextUrl))
    .replaceAll('"@/lib/supabase/server"', JSON.stringify(serverUrl))
    .replaceAll('"@/lib/business"', JSON.stringify(businessUrl))
    .replaceAll('"@/lib/sales-assistant"', JSON.stringify(salesUrl));
const { POST } = await import(moduleUrl(source));
const { emptySalesState, runSalesTurn } = await import(salesUrl);

const owner = "10000000-0000-4000-8000-000000000001";
const profile = {
    name: "Проверенный магазин", category: "Retail & online shop", description: "Цветы и подарки", location: "Алматы",
    hours: "09:00–20:00", phone: "+77770001122", language: "Russian", tone: "Friendly", services: [],
    deliveryAreas: "Алматы", deliveryFeeKzt: 1000,
};
const product = {
    id: "30000000-0000-4000-8000-000000000001", name: "Проверенные розы", price_kzt: 12000, description: "15 роз",
};

function installClient({ user = { id: owner }, savedProfile = profile, accessError = null, access = (id) => id === owner } = {}) {
    const context = { reads: [], writes: [], rpcCalls: [] };
    const rows = {
        business_profiles: savedProfile ? [{ owner_id: owner, profile: savedProfile }] : [],
        catalog_products: [{ ...product, owner_id: owner }, { ...product, id: "other-product", name: "Чужой букет", owner_id: "other" }],
    };
    const rejectWrite = (...args) => { context.writes.push(args); throw new Error("Owner preview must never write customer orders"); };
    context.client = {
        auth: { getUser: async () => ({ data: { user }, error: null }) },
        rpc(name, args) {
            context.rpcCalls.push({ name, args });
            if (name !== "has_workspace_access") return rejectWrite(name, args);
            return Promise.resolve({ data: access(user?.id), error: accessError });
        },
        from(table) {
            const filters = [];
            const query = {
                select() { return query; },
                eq(column, value) { filters.push([column, value]); return query; },
                order() { return query; },
                limit() { return query; },
                insert: rejectWrite, upsert: rejectWrite, update: rejectWrite, delete: rejectWrite,
                async maybeSingle() { const result = await query; return { ...result, data: result.data[0] ?? null }; },
                then(resolve, reject) {
                    context.reads.push({ table, filters: [...filters] });
                    const data = (rows[table] ?? []).filter((row) => filters.every(([column, value]) => row[column] === value));
                    return Promise.resolve({ data, error: null }).then(resolve, reject);
                },
            };
            return query;
        },
    };
    globalThis.__floralOwnerPreviewTest = context;
    return context;
}

const request = (body) => new Request("https://floral.example/api/chat", { method: "POST", body: JSON.stringify(body) });
after(() => { delete globalThis.__floralOwnerPreviewTest; });

test("owner preview rejects unauthenticated requests before business or catalog reads", async () => {
    const context = installClient({ user: null });
    const response = await POST(request({ message: "/catalog", business: profile }));
    assert.equal(response.status, 401);
    assert.equal(context.reads.length, 0);
    assert.equal(context.writes.length, 0);
    assert.equal(context.rpcCalls.length, 0);
});

test("expired account cannot use another owner's paid access or read business data", async () => {
    const context = installClient({ user: { id: "expired-owner" } });
    const response = await POST(request({ message: "/catalog", owner_id: owner, hasAccess: true, business: profile }));
    assert.equal(response.status, 402);
    assert.equal((await response.json()).code, "SUBSCRIPTION_REQUIRED");
    assert.deepEqual(context.rpcCalls, [{ name: "has_workspace_access", args: undefined }]);
    assert.deepEqual(context.reads, []);
    assert.deepEqual(context.writes, []);
});

test("preview fails closed when subscription verification fails or returns no boolean", async () => {
    for (const options of [{ accessError: { code: "rpc-unavailable" } }, { access: () => null }]) {
        const context = installClient(options);
        const response = await POST(request({ message: "/catalog" }));
        assert.equal(response.status, 503);
        assert.match((await response.json()).error, /Не удалось проверить доступ/);
        assert.deepEqual(context.reads, []);
        assert.deepEqual(context.writes, []);
    }
});

test("preview ignores forged request business data and reads only the signed-in owner's catalog", async () => {
    const context = installClient();
    const response = await POST(request({
        message: "/catalog", owner_id: "other", business: { ...profile, name: "Поддельный магазин" },
        products: [{ ...product, name: "Бесплатный букет", price_kzt: 0 }],
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.preview, true);
    assert.match(body.reply, /Проверенные розы/);
    assert.doesNotMatch(body.reply, /Чужой букет|Бесплатный букет|Поддельный магазин/);
    assert.deepEqual(context.reads.map((read) => read.table).sort(), ["business_profiles", "catalog_products"]);
    for (const read of context.reads) assert.deepEqual(read.filters, [["owner_id", owner]]);
    assert.equal(context.writes.length, 0);
});

test("confirming a complete preview marks it as a test and never inserts a customer order", async () => {
    let state = emptySalesState();
    for (const message of ["Маме на день рождения", "15000", "1", "Айдана", "+77771234567", "Алматы, Абая 12", "Завтра после 15:00"]) {
        state = runSalesTurn({ message, profile, products: [product], state }).state;
    }
    assert.equal(state.step, "review");
    const context = installClient();
    const response = await POST(request({ message: "Подтверждаю", state }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.preview, true);
    assert.equal(body.state.step, "submitted");
    assert.equal(body.state.orderId, "test");
    assert.match(body.reply, /Тестовая заявка собрана/);
    assert.match(body.reply, /не создаёт настоящую заявку/);
    assert.equal(context.writes.length, 0);
    assert.ok(context.reads.every((read) => ["business_profiles", "catalog_products"].includes(read.table)));
});

test("request-supplied profile cannot substitute for an unsaved business profile", async () => {
    const context = installClient({ savedProfile: null });
    const response = await POST(request({ message: "/start", business: profile, profile }));
    assert.equal(response.status, 409);
    assert.equal(context.writes.length, 0);
});
