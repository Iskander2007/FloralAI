import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const transpile = (source) => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const businessUrl = moduleUrl(transpile(await readFile(new URL("../../../../lib/business.ts", import.meta.url), "utf8")));
const salesUrl = moduleUrl(transpile(await readFile(new URL("../../../../lib/sales-assistant.ts", import.meta.url), "utf8")));
const nextUrl = moduleUrl("export const NextResponse = {json: (body, init) => new Response(JSON.stringify(body), {...init, headers: {'content-type': 'application/json', ...init?.headers}})};");
const adminUrl = moduleUrl("export const createSupabaseAdminClient = () => globalThis.__floralBackendTest.admin;");
const serverUrl = moduleUrl("export const createSupabaseServerClient = async () => globalThis.__floralBackendTest.admin;");
const webhookSource = transpile(await readFile(new URL("./route.ts", import.meta.url), "utf8"))
    .replaceAll('"next/server"', JSON.stringify(nextUrl))
    .replaceAll('"@/lib/business"', JSON.stringify(businessUrl))
    .replaceAll('"@/lib/sales-assistant"', JSON.stringify(salesUrl))
    .replaceAll('"@/lib/supabase/admin"', JSON.stringify(adminUrl));
const orderSource = transpile(await readFile(new URL("../../orders/route.ts", import.meta.url), "utf8"))
    .replaceAll('"next/server"', JSON.stringify(nextUrl))
    .replaceAll('"@/lib/supabase/server"', JSON.stringify(serverUrl));
const webhook = await import(moduleUrl(webhookSource));
const orderApi = await import(moduleUrl(orderSource));
const { emptySalesState, runSalesTurn } = await import(salesUrl);
const originalFetch = globalThis.fetch;
const originalToken = process.env.TELEGRAM_BOT_TOKEN;
const originalSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

const owner = "10000000-0000-4000-8000-000000000001";
const businessId = "20000000-0000-4000-8000-000000000001";
const product = { id: "30000000-0000-4000-8000-000000000001", name: "Розы", price_kzt: 12000, description: "15 роз" };
const profile = {
    name: "Цветы", category: "Retail & online shop", description: "Цветочный магазин", location: "Алматы",
    hours: "09:00–20:00", phone: "+77770001122", language: "Russian", tone: "Friendly", services: [],
    deliveryAreas: "Алматы", deliveryFeeKzt: null,
};

function installContext({ rows = {}, commit, user = { id: owner }, access = true, accessError = null } = {}) {
    const context = { sends: [], media: [], queries: [], commits: [], updates: [], rows, user, accessChecks: [] };
    context.admin = {
        auth: { getUser: async () => ({ data: { user: context.user }, error: null }) },
        from(table) {
            const filters = [];
            const ordering = [];
            let rowLimit = Infinity;
            let cursorFilter = null;
            let update = null;
            const query = {
                select() { return query; },
                eq(column, value) { filters.push([column, value]); return query; },
                order(column, options) { ordering.push([column, options.ascending]); return query; },
                limit(count) { rowLimit = count; return query; },
                or(expression) {
                    const parsed = expression.match(/^created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.lt\.([a-f0-9-]+)\)$/i);
                    assert.ok(parsed, "expected a sanitized order cursor filter");
                    assert.equal(parsed[1], parsed[2]);
                    cursorFilter = { created_at: parsed[1], id: parsed[3] };
                    return query;
                },
                update(value) { update = value; context.updates.push(value); return query; },
                async maybeSingle() { const result = await query; return { ...result, data: result.data?.[0] ?? null }; },
                then(resolve, reject) {
                    context.queries.push({ table, filters: [...filters], ordering: [...ordering], rowLimit, cursorFilter, update });
                    const tableRows = typeof context.rows[table] === "function" ? context.rows[table]() : (context.rows[table] ?? []);
                    const result = tableRows.filter((row) => filters.every(([column, value]) => String(row[column]) === String(value)))
                        .filter((row) => !cursorFilter || row.created_at < cursorFilter.created_at
                            || (row.created_at === cursorFilter.created_at && row.id < cursorFilter.id))
                        .map((row) => {
                            if (update) Object.assign(row, update);
                            return row;
                        });
                    result.sort((left, right) => {
                        for (const [column, ascending] of ordering) {
                            const comparison = left[column] < right[column] ? -1 : left[column] > right[column] ? 1 : 0;
                            if (comparison) return ascending ? comparison : -comparison;
                        }
                        return 0;
                    });
                    return Promise.resolve({ data: result.slice(0, rowLimit), error: null }).then(resolve, reject);
                },
            };
            return query;
        },
        async rpc(name, args) {
            if (name === "business_has_paid_access") {
                context.accessChecks.push(args);
                return { data: access, error: accessError };
            }
            context.commits.push({ name, args });
            return commit ? commit(args, context) : { data: { outcome: "committed", reply: "Заявка сохранена." }, error: null };
        },
    };
    globalThis.__floralBackendTest = context;
    globalThis.fetch = async (url, options) => {
        assert.match(String(url), /^https:\/\/api\.telegram\.org\/botunit-test-token\/(sendMessage|sendPhoto|sendMediaGroup)$/);
        if (String(url).endsWith("/sendMessage")) context.sends.push(JSON.parse(options.body));
        else context.media.push({ method: String(url).split("/").at(-1), body: JSON.parse(options.body) });
        return Response.json({ ok: true });
    };
    return context;
}

function request(message = "Здравствуйте", updateId = 12, secret = "unit-test-secret", chatType = "private") {
    return new Request("https://floral.example/api/telegram/webhook", {
        method: "POST", headers: { "x-telegram-bot-api-secret-token": secret },
        body: JSON.stringify({ update_id: updateId, message: { chat: { id: 555, type: chatType }, text: message } }),
    });
}

function businessRows(state = emptySalesState()) {
    return {
        telegram_businesses: [{ id: businessId, owner_id: owner, business_name: "Цветы", active: true, start_code: "a".repeat(32) }],
        telegram_chats: [{ chat_id: 555, business_id: businessId, last_update_id: 11, last_reply: "Предыдущий ответ", revision: 5, state }],
        business_profiles: [{ owner_id: owner, profile }],
        catalog_products: [{ ...product, owner_id: owner }],
    };
}

test("expired shop does not receive new Telegram orders or expose its catalog", async () => {
    const context = installContext({ rows: businessRows(), access: false });
    const response = await webhook.POST(request("Каталог"));
    assert.equal(response.status, 200);
    assert.deepEqual(context.accessChecks, [{ business_owner: owner }]);
    assert.equal(context.commits.length, 0);
    assert.equal(context.media.length, 0);
    assert.equal(context.queries.some((query) => query.table === "catalog_products"), false);
    assert.match(context.sends[0].text, /временно не принимает/);
});

test("Telegram subscription check fails closed without a sales commit or success reply", async () => {
    for (const options of [{ accessError: { code: "08006" } }, { access: null }]) {
        const context = installContext({ rows: businessRows(), ...options });
        const response = await webhook.POST(request("Подтверждаю"));
        assert.equal(response.status, 503);
        assert.equal(context.commits.length, 0);
        assert.equal(context.sends.length, 0);
    }
});

function photoRows(count = 1) {
    const rows = businessRows();
    rows.catalog_products = Array.from({ length: count }, (_, index) => ({ ...product, id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, owner_id: owner, name: `Букет ${index + 1}`, price_kzt: (index + 1) * 1000, image_path: `${owner}/40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}.jpg` }));
    return rows;
}

test("sends a catalog photo with price only after its snapshot has committed", async () => {
    const context = installContext({ rows: photoRows(), commit: (args, current) => {
        assert.equal(current.media.length, 0);
        assert.equal(args.p_state.telegramCatalog.length, 1);
        return { data: { outcome: "committed", reply: args.p_reply }, error: null };
    } });
    assert.equal((await webhook.POST(request("/catalog"))).status, 200);
    assert.equal(context.media[0].method, "sendPhoto");
    assert.equal(context.media[0].body.chat_id, 555);
    assert.match(context.media[0].body.photo, /\/storage\/v1\/object\/public\/product-images\//);
    assert.match(context.media[0].body.caption, /1\. Букет 1 — 1\s000 ₸/);
    assert.equal(context.sends.length, 1);
});

test("sends only the requested page as an album and excludes another owner's image path", async () => {
    const rows = photoRows(12);
    rows.catalog_products[8].image_path = `99999999-0000-4000-8000-000000000000/40000000-0000-4000-8000-000000000001.jpg`;
    const context = installContext({ rows, commit: (args) => ({ data: { outcome: "committed", reply: args.p_reply }, error: null }) });
    assert.equal((await webhook.POST(request("/catalog 2"))).status, 200);
    assert.equal(context.media[0].method, "sendMediaGroup");
    assert.equal(context.media[0].body.media.length, 3);
    assert.match(context.media[0].body.media[0].caption, /^10\. Букет 10/);
    assert.match(context.media[0].body.media[2].caption, /^12\. Букет 12/);
});

test("a duplicate replays the committed photo and price without reading a changed catalog", async () => {
    const rows = photoRows();
    const originalPhoto = { photo: `https://unit-test.supabase.co/storage/v1/object/public/product-images/${owner}/40000000-0000-4000-8000-000000000001.jpg`, caption: "1. Розы — 12 000 ₸" };
    rows.telegram_chats[0].state = { ...emptySalesState(), telegramCatalog: [originalPhoto] };
    const context = installContext({ rows });
    assert.equal((await webhook.POST(request("/catalog", 11))).status, 200);
    assert.deepEqual(context.media[0].body, { chat_id: 555, ...originalPhoto });
    assert.equal(context.queries.some(({ table }) => table === "catalog_products"), false);
    assert.equal(context.commits.length, 0);
});

test("missing photos keep the text catalog, and a permanent photo error does not block checkout", async () => {
    const missing = installContext({ rows: businessRows(), commit: (args) => ({ data: { outcome: "committed", reply: args.p_reply }, error: null }) });
    assert.equal((await webhook.POST(request("/catalog"))).status, 200);
    assert.equal(missing.media.length, 0);
    assert.match(missing.sends[0].text, /Розы/);
    const context = installContext({ rows: photoRows(), commit: (args) => ({ data: { outcome: "committed", reply: args.p_reply }, error: null }) });
    const mockedFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => String(url).endsWith("/sendPhoto") ? Response.json({ ok: false }, { status: 400 }) : mockedFetch(url, options);
    assert.equal((await webhook.POST(request("/catalog"))).status, 200);
    assert.match(context.sends[0].text, /Фото сейчас недоступны/);
    assert.equal(context.commits.length, 1);
});

test("transient photo delivery failure requests retry and never commits a second turn", async () => {
    const context = installContext({ rows: photoRows(), commit: (args, current) => {
        current.rows.telegram_chats[0] = { ...current.rows.telegram_chats[0], last_update_id: args.p_update_id, last_reply: args.p_reply, state: args.p_state };
        return { data: { outcome: "committed", reply: args.p_reply }, error: null };
    } });
    const mockedFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ ok: false }, { status: 503 });
    assert.equal((await webhook.POST(request("/catalog"))).status, 503);
    assert.equal(context.commits.length, 1);
    globalThis.fetch = mockedFetch;
    assert.equal((await webhook.POST(request("/catalog"))).status, 200);
    assert.equal(context.commits.length, 1);
    assert.equal(context.media.length, 1);
});

beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = "unit-test-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "unit-test-secret";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test.supabase.co";
});
after(() => {
    globalThis.fetch = originalFetch;
    delete globalThis.__floralBackendTest;
    if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = originalToken;
    if (originalSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET; else process.env.TELEGRAM_WEBHOOK_SECRET = originalSecret;
    if (originalSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
});

test("rejects an incorrect webhook secret before accessing storage or Telegram", async () => {
    const context = installContext();
    assert.equal((await webhook.POST(request("Здравствуйте", 12, "wrong"))).status, 401);
    assert.equal(context.queries.length, 0);
    assert.equal(context.sends.length, 0);
});

test("ignores group conversations without reading personal business state", async () => {
    const context = installContext();
    assert.equal((await webhook.POST(request("Привет", 12, "unit-test-secret", "group"))).status, 200);
    assert.equal(context.queries.length, 0);
    assert.equal(context.sends.length, 0);
});

test("replays only an exactly duplicated update and silently drops older updates", async () => {
    const context = installContext({ rows: businessRows() });
    assert.equal((await webhook.POST(request("Привет", 11))).status, 200);
    assert.equal(context.sends[0].text, "Предыдущий ответ");
    assert.equal((await webhook.POST(request("Привет", 10))).status, 200);
    assert.equal(context.sends.length, 1);
    assert.equal(context.commits.length, 0);
});

test("does not send a successful reply when the transaction fails", async () => {
    const context = installContext({ rows: businessRows(), commit: () => ({ error: { code: "db-error" }, data: null }) });
    assert.equal((await webhook.POST(request())).status, 503);
    assert.equal(context.commits.length, 1);
    assert.equal(context.sends.length, 0);
});

test("a new shop deep link resets the draft before committing its reply", async () => {
    const old = emptySalesState();
    old.draft.customerName = "Секретное имя";
    old.draft.customerPhone = "+77771234567";
    const rows = businessRows(old);
    const newBusiness = "20000000-0000-4000-8000-000000000002";
    rows.telegram_businesses.push({ id: newBusiness, owner_id: owner, business_name: "Другой магазин", active: true, start_code: "b".repeat(32) });
    const context = installContext({ rows });
    assert.equal((await webhook.POST(request(`/start ${"b".repeat(32)}`))).status, 200);
    const args = context.commits[0].args;
    assert.equal(args.p_business_id, newBusiness);
    assert.equal(args.p_expected_business_id, businessId);
    assert.equal(args.p_state.draft.customerName, "");
    assert.equal(args.p_state.draft.customerPhone, "");
    assert.doesNotMatch(args.p_reply, /Секретное имя|77771234567/);
});

test("commits a fully reviewed request with an unknown shipping total preserved as null", async () => {
    let state = emptySalesState();
    for (const message of ["Маме на день рождения", "15000", "1", "Айдана", "+7 777 123 45 67", "Алматы, Абая 12", "Завтра после 15:00"]) {
        state = runSalesTurn({ message, profile, products: [product], state }).state;
    }
    assert.equal(state.step, "review");
    const context = installContext({ rows: businessRows(state) });
    assert.equal((await webhook.POST(request("Подтверждаю"))).status, 200);
    const args = context.commits[0].args;
    assert.equal(args.p_order.product_id, product.id);
    assert.equal(args.p_order.expected_delivery_fee_kzt, null);
    assert.equal(args.p_state.step, "submitted");
    assert.equal(context.sends[0].text, "Заявка сохранена.");
    assert.doesNotMatch(context.sends[0].text, /перевод|получатель|банк/i);
});

test("retries an optimistic conflict and sends only the transaction's stored reply", async () => {
    const context = installContext({ rows: businessRows(), commit: (_args, current) => ({
        data: current.commits.length === 1 ? { outcome: "conflict" } : { outcome: "committed", reply: "Проверенный сохранённый ответ" }, error: null,
    }) });
    assert.equal((await webhook.POST(request())).status, 200);
    assert.equal(context.commits.length, 2);
    assert.equal(context.sends.length, 1);
    assert.equal(context.sends[0].text, "Проверенный сохранённый ответ");
});

test("stops after three optimistic conflicts without sending a success reply", async () => {
    const context = installContext({ rows: businessRows(), commit: () => ({ data: { outcome: "conflict" }, error: null }) });
    assert.equal((await webhook.POST(request())).status, 503);
    assert.equal(context.commits.length, 3);
    assert.equal(context.sends.length, 0);
});

test("a price change during confirmation requires the customer to review the new quote", async () => {
    let state = emptySalesState();
    for (const message of ["Маме на день рождения", "15000", "1", "Айдана", "+77771234567", "Алматы, Абая 12", "Завтра после 15:00"]) {
        state = runSalesTurn({ message, profile, products: [product], state }).state;
    }
    const rows = businessRows(state);
    const context = installContext({ rows, commit: (args, current) => {
        if (current.commits.length === 1) {
            rows.catalog_products = [{ ...product, owner_id: owner, price_kzt: 13000 }];
            return { data: { outcome: "quote_changed" }, error: null };
        }
        return { data: { outcome: "committed", reply: args.p_reply }, error: null };
    } });
    assert.equal((await webhook.POST(request("Подтверждаю"))).status, 200);
    assert.ok(context.commits[0].args.p_order);
    assert.equal(context.commits[1].args.p_order, null);
    assert.equal(context.commits[1].args.p_state.step, "review");
    assert.equal(context.commits[1].args.p_state.reviewedQuote.productPriceKzt, 13000);
    assert.match(context.sends[0].text, /подтвердите ещё раз/i);
});

test("a Telegram send failure can replay the committed reply without committing another order", async () => {
    const rows = businessRows();
    const context = installContext({ rows, commit: (args) => {
        rows.telegram_chats[0] = { ...rows.telegram_chats[0], last_update_id: args.p_update_id, last_reply: "Сохранённая заявка", state: args.p_state };
        return { data: { outcome: "committed", reply: "Сохранённая заявка" }, error: null };
    } });
    const successFetch = globalThis.fetch;
    let failed = false;
    globalThis.fetch = async (...args) => {
        if (!failed) { failed = true; throw new Error("Synthetic send failure"); }
        return successFetch(...args);
    };
    assert.equal((await webhook.POST(request())).status, 503);
    assert.equal((await webhook.POST(request())).status, 200);
    assert.equal(context.commits.length, 1);
    assert.equal(context.sends.length, 1);
    assert.equal(context.sends[0].text, "Сохранённая заявка");
});

test("orders require authentication and reads are scoped to the signed-in owner", async () => {
    const unauthenticated = installContext({ user: null });
    assert.equal((await orderApi.GET()).status, 401);
    assert.equal(unauthenticated.queries.length, 0);
    const context = installContext({ rows: { sales_orders: [{ id: "mine", owner_id: owner }, { id: "someone-else", owner_id: "other" }] } });
    const response = await orderApi.GET();
    assert.deepEqual((await response.json()).orders.map((order) => order.id), ["mine"]);
    assert.deepEqual(context.queries[0].filters, [["owner_id", owner]]);
    assert.match(response.headers.get("cache-control"), /no-store/);
});

test("cursor pagination reaches older orders with tied timestamps and preserves microseconds", async () => {
    const createdAt = "2026-10-13T05:30:12.123456+00:00";
    const idFor = (index) => `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const orders = Array.from({ length: 127 }, (_, index) => ({
        id: idFor(index + 1), owner_id: owner, created_at: createdAt, status: "awaiting_confirmation",
    }));
    orders.push({ id: idFor(500), owner_id: owner, created_at: "2026-10-12T05:30:12.123456+00:00", status: "awaiting_confirmation" });
    orders.push({ id: idFor(999), owner_id: "other", created_at: createdAt, status: "awaiting_confirmation" });
    const context = installContext({ rows: { sales_orders: orders } });
    const first = await (await orderApi.GET(new Request("https://floral.example/api/orders"))).json();
    assert.equal(first.orders.length, 50);
    assert.equal(first.orders[0].id, idFor(127));
    assert.equal(first.orders.at(-1).id, idFor(78));
    assert.deepEqual(JSON.parse(Buffer.from(first.nextCursor, "base64url").toString("utf8")), {
        created_at: createdAt, id: idFor(78),
    });
    // A newly received request must not shift the next page or repeat an existing row.
    orders.push({ id: idFor(128), owner_id: owner, created_at: createdAt, status: "awaiting_confirmation" });
    const second = await (await orderApi.GET(new Request(`https://floral.example/api/orders?after=${first.nextCursor}`))).json();
    const third = await (await orderApi.GET(new Request(`https://floral.example/api/orders?after=${second.nextCursor}`))).json();
    assert.equal(second.orders.length, 50);
    assert.equal(second.orders[0].id, idFor(77));
    assert.equal(third.orders.length, 28);
    assert.equal(third.orders.at(-2).id, idFor(1));
    assert.equal(third.orders.at(-1).id, idFor(500));
    assert.equal(third.nextCursor, null);
    const allIds = [...first.orders, ...second.orders, ...third.orders].map((order) => order.id);
    assert.equal(allIds.length, 128);
    assert.equal(new Set(allIds).size, 128);
    for (const query of context.queries) {
        assert.deepEqual(query.filters, [["owner_id", owner]]);
        assert.deepEqual(query.ordering, [["created_at", false], ["id", false]]);
        assert.equal(query.rowLimit, 51);
    }
});

test("rejects malformed pagination cursors before querying the order table", async () => {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const validId = "40000000-0000-4000-8000-000000000001";
    const invalid = [
        "", "%%%", "a".repeat(513), encode([]),
        encode({ created_at: "2026-02-30T10:00:00Z", id: validId }),
        encode({ created_at: "2026-10-13T25:00:00Z", id: validId }),
        encode({ created_at: "2026-10-13", id: validId }),
        encode({ created_at: "2026-10-13T10:00:00Z),owner_id.neq.x", id: validId }),
        encode({ created_at: "2026-10-13T10:00:00Z", id: `${validId},owner_id.neq.x` }),
        encode({ created_at: "2026-10-13T10:00:00Z", id: validId, owner_id: "other" }),
    ];
    const context = installContext();
    for (const cursor of invalid) {
        const response = await orderApi.GET(new Request(`https://floral.example/api/orders?after=${encodeURIComponent(cursor)}`));
        assert.equal(response.status, 400, `must reject ${cursor}`);
    }
    assert.equal(context.queries.length, 0);
});

test("a merchant cannot update another owner's request or introduce payment statuses", async () => {
    const id = "40000000-0000-4000-8000-000000000001";
    const context = installContext({ rows: { sales_orders: [{ id, owner_id: "other", status: "awaiting_confirmation" }] } });
    const patch = (status) => Object.assign(new Request("https://floral.example/api/orders", {
        method: "PATCH", body: JSON.stringify({ id, status }),
    }), { nextUrl: new URL("https://floral.example/api/orders") });
    assert.equal((await orderApi.PATCH(patch("confirmed"))).status, 404);
    assert.equal((await orderApi.PATCH(patch("awaiting_payment"))).status, 400);
    assert.equal(context.updates.length, 0);
});

test("owner status updates write only status and include optimistic tenant filters", async () => {
    const id = "40000000-0000-4000-8000-000000000001";
    const context = installContext({ rows: { sales_orders: [{ id, owner_id: owner, status: "awaiting_confirmation" }] } });
    const patch = Object.assign(new Request("https://floral.example/api/orders", {
        method: "PATCH", body: JSON.stringify({ id, status: "confirmed", product_price_kzt: 1, owner_id: "other" }),
    }), { nextUrl: new URL("https://floral.example/api/orders") });
    assert.equal((await orderApi.PATCH(patch)).status, 200);
    assert.deepEqual(context.updates, [{ status: "confirmed" }]);
    assert.deepEqual(context.queries.at(-1).filters, [["id", id], ["owner_id", owner], ["status", "awaiting_confirmation"]]);
});

function statusRequest(id, status) {
    const url = "https://floral.example/api/orders";
    return Object.assign(new Request(url, {
        method: "PATCH", body: JSON.stringify({ id, status }),
    }), { nextUrl: new URL(url) });
}

test("a confirmed Telegram checkout appears only for its owner and can be started then fulfilled", async () => {
    const rows = { ...businessRows(), sales_orders: [] };
    const context = installContext({ rows, commit: (args, current) => {
        const business = current.rows.telegram_businesses.find((entry) => entry.id === args.p_business_id);
        assert.ok(business);
        const previousChat = current.rows.telegram_chats[0];
        assert.equal(args.p_expected_revision, previousChat.revision);
        if (args.p_order) {
            const { draft } = args.p_order;
            current.rows.sales_orders.push({
                id: args.p_order.id,
                owner_id: business.owner_id,
                business_id: business.id,
                chat_id: args.p_chat_id,
                source_update_id: args.p_update_id,
                created_at: "2026-10-13T05:30:12.123456+00:00",
                status: "awaiting_confirmation",
                customer_name: draft.customerName,
                customer_phone: draft.customerPhone.replace(/[^0-9+]/g, ""),
                delivery_address: draft.deliveryAddress,
                delivery_date: draft.deliveryDate,
                occasion: draft.occasion,
                note: draft.note,
                product_id: args.p_order.product_id,
                product_name: args.p_order.expected_product_name,
                product_price_kzt: args.p_order.expected_price_kzt,
                delivery_fee_kzt: args.p_order.expected_delivery_fee_kzt,
                total_kzt: args.p_order.expected_delivery_fee_kzt === null ? null
                    : args.p_order.expected_price_kzt + args.p_order.expected_delivery_fee_kzt,
            });
        }
        current.rows.telegram_chats[0] = {
            ...previousChat, last_update_id: args.p_update_id, last_reply: args.p_reply,
            revision: previousChat.revision + 1, state: args.p_state,
        };
        return { data: { outcome: "committed", reply: args.p_reply }, error: null };
    } });
    const messages = [
        "Маме на день рождения", "15000", "1", "Айдана", "+7 777 123 45 67",
        "Алматы, Абая 12", "Завтра после 15:00", "Подтверждаю",
    ];
    for (const [index, message] of messages.entries()) {
        assert.equal((await webhook.POST(request(message, 12 + index))).status, 200);
        assert.equal(rows.sales_orders.length, index === messages.length - 1 ? 1 : 0,
            "the order is created only after the customer explicitly confirms the review");
    }
    const response = await orderApi.GET();
    assert.equal(response.status, 200);
    const [order] = (await response.json()).orders;
    assert.match(order.id, /^[0-9a-f-]{36}$/i);
    assert.equal(order.status, "awaiting_confirmation");
    assert.equal(order.owner_id, owner);
    assert.equal(order.customer_name, "Айдана");
    assert.equal(order.customer_phone, "+77771234567");
    assert.equal(order.delivery_address, "Алматы, Абая 12");
    assert.equal(order.delivery_date, "Завтра после 15:00");
    assert.equal(order.product_id, product.id);
    assert.equal(order.product_name, product.name);
    assert.equal(order.product_price_kzt, 12000);
    assert.equal(order.total_kzt, null);
    assert.equal(context.commits.filter(({ args }) => args.p_order).length, 1);

    // Telegram retries must not create an extra request after the successful commit.
    assert.equal((await webhook.POST(request("Подтверждаю", 19))).status, 200);
    assert.equal(rows.sales_orders.length, 1);
    assert.equal(context.commits.length, messages.length);

    context.user = { id: "10000000-0000-4000-8000-000000000002" };
    assert.deepEqual((await (await orderApi.GET()).json()).orders, []);
    assert.equal((await orderApi.PATCH(statusRequest(order.id, "confirmed"))).status, 404);
    assert.equal(rows.sales_orders[0].status, "awaiting_confirmation");

    context.user = { id: owner };
    for (const status of ["confirmed", "fulfilled"]) {
        const changed = await orderApi.PATCH(statusRequest(order.id, status));
        assert.equal(changed.status, 200);
        assert.equal((await changed.json()).order.status, status);
        const refreshed = (await (await orderApi.GET()).json()).orders;
        assert.equal(refreshed[0].status, status, "status remains saved after refreshing the owner list");
        assert.equal(refreshed[0].customer_name, "Айдана");
    }
    for (const status of ["confirmed", "awaiting_confirmation", "cancelled"]) {
        assert.equal((await orderApi.PATCH(statusRequest(order.id, status))).status, 409);
    }
    assert.equal(rows.sales_orders[0].status, "fulfilled");
    assert.deepEqual(context.updates, [{ status: "confirmed" }, { status: "fulfilled" }]);
});

test("a cancelled request remains cancelled and cannot be resumed or fulfilled", async () => {
    const id = "40000000-0000-4000-8000-000000000001";
    const rows = { sales_orders: [{ id, owner_id: owner, status: "awaiting_confirmation" }] };
    const context = installContext({ rows });
    assert.equal((await orderApi.PATCH(statusRequest(id, "cancelled"))).status, 200);
    for (const status of ["awaiting_confirmation", "confirmed", "fulfilled"]) {
        assert.equal((await orderApi.PATCH(statusRequest(id, status))).status, 409);
    }
    assert.equal((await (await orderApi.GET()).json()).orders[0].status, "cancelled");
    assert.deepEqual(context.updates, [{ status: "cancelled" }]);
});

test("status filtering applies before pagination and scopes every page to the owner", async () => {
    const createdAt = "2026-10-13T05:30:12.123456+00:00";
    const idFor = (index) => `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const rows = { sales_orders: [
        ...Array.from({ length: 121 }, (_, index) => ({
            id: idFor(index + 1), owner_id: owner, created_at: createdAt, status: "confirmed",
        })),
        ...Array.from({ length: 70 }, (_, index) => ({
            id: idFor(index + 200), owner_id: owner, created_at: createdAt, status: "awaiting_confirmation",
        })),
        ...Array.from({ length: 60 }, (_, index) => ({
            id: idFor(index + 300), owner_id: "other", created_at: createdAt, status: "confirmed",
        })),
    ] };
    const context = installContext({ rows });
    const getPage = (cursor) => orderApi.GET(new Request(
        `https://floral.example/api/orders?status=confirmed${cursor ? `&after=${cursor}` : ""}`,
    )).then((response) => response.json());
    const first = await getPage();
    assert.equal(first.orders.length, 50);
    assert.equal(first.orders[0].id, idFor(121));
    assert.equal(first.orders.at(-1).id, idFor(72));
    assert.ok(first.nextCursor);
    const second = await getPage(first.nextCursor);
    assert.equal(second.orders.length, 50);
    assert.equal(second.orders[0].id, idFor(71));
    assert.equal(second.orders.at(-1).id, idFor(22));
    const third = await getPage(second.nextCursor);
    assert.equal(third.orders.length, 21);
    assert.equal(third.orders.at(-1).id, idFor(1));
    assert.equal(third.nextCursor, null);
    const allOrders = [...first.orders, ...second.orders, ...third.orders];
    assert.equal(new Set(allOrders.map(({ id }) => id)).size, 121);
    assert.ok(allOrders.every((order) => order.owner_id === owner && order.status === "confirmed"));
    for (const query of context.queries) {
        assert.deepEqual(query.filters, [["owner_id", owner], ["status", "confirmed"]]);
        assert.deepEqual(query.ordering, [["created_at", false], ["id", false]]);
        assert.equal(query.rowLimit, 51);
    }
    assert.deepEqual(context.queries[1].cursorFilter, { created_at: createdAt, id: idFor(72) });
});

test("each supported status can be filtered and invalid filters never query order storage", async () => {
    const statuses = ["awaiting_confirmation", "confirmed", "fulfilled", "cancelled"];
    const context = installContext({ rows: { sales_orders: statuses.map((status, index) => ({
        id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        owner_id: owner, status, created_at: "2026-10-13T05:30:12.123456+00:00",
    })) } });
    for (const status of statuses) {
        const response = await orderApi.GET(new Request(`https://floral.example/api/orders?status=${status}`));
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).orders.map((order) => order.status), [status]);
    }
    const queriesBeforeInvalid = context.queries.length;
    for (const status of ["", "all", "pending", "awaiting_payment", "CONFIRMED", "confirmed,owner_id.neq.other", "__proto__"]) {
        const response = await orderApi.GET(new Request(`https://floral.example/api/orders?status=${encodeURIComponent(status)}`));
        assert.equal(response.status, 400, `must reject status ${JSON.stringify(status)}`);
    }
    assert.equal(context.queries.length, queriesBeforeInvalid);
});
