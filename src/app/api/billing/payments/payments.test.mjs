import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import ts from "typescript";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const transpile = (source) => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const serverUrl = moduleUrl("export const createSupabaseServerClient = async () => globalThis.__floralPaymentTest.client;");
const nextUrl = moduleUrl("export const NextResponse = {json: (body, init) => new Response(JSON.stringify(body), {...init, headers: {'content-type': 'application/json', ...init?.headers}})};");
async function loadRoute(path) {
    const source = transpile(await readFile(new URL(path, import.meta.url), "utf8"))
        .replaceAll('"next/server"', JSON.stringify(nextUrl))
        .replaceAll('"@/lib/supabase/server"', JSON.stringify(serverUrl));
    return import(moduleUrl(source));
}
const { GET, POST } = await loadRoute("./route.ts");
const { PATCH } = await loadRoute("./[id]/route.ts");
const owner = "10000000-0000-4000-8000-000000000001";
const paymentId = "20000000-0000-4000-8000-000000000001";
const payment = { id: paymentId, owner_id: owner, plan: "starter", billing_cycle: "monthly", amount_kzt: 9950, status: "requested" };

function context({ user = { id: owner }, operator = false, operation = () => ({ data: payment, error: null }), rows = [] } = {}) {
    const state = { authCalls: 0, queries: [], calls: [] };
    state.client = {
        auth: { getUser: async () => { state.authCalls += 1; return { data: { user }, error: null }; } },
        from(table) {
            const queryState = { table, filters: [], limit: null, ordering: [] };
            const query = {
                select() { return query; },
                in(column, values) { queryState.filters.push([column, values]); return query; },
                order(column, options) { queryState.ordering.push([column, options.ascending]); return query; },
                limit(value) { queryState.limit = value; return query; },
                then(resolve, reject) {
                    state.queries.push(queryState);
                    return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
                },
            };
            return query;
        },
        rpc(name, args) {
            state.calls.push({ name, args });
            if (name === "is_subscription_operator") return Promise.resolve({ data: operator, error: null });
            return { single: async () => operation(name, args, state) };
        },
    };
    globalThis.__floralPaymentTest = state;
    return state;
}
function request(body, { method = "POST", origin, id = paymentId } = {}) {
    const path = method === "PATCH" ? `/api/billing/payments/${id}` : "/api/billing/payments";
    return new Request(`https://floral.example${path}`, {
        method, body: typeof body === "string" ? body : JSON.stringify(body),
        headers: origin ? { origin } : {},
    });
}
const patch = (body, options = {}) => PATCH(request(body, { method: "PATCH", ...options }), {
    params: Promise.resolve({ id: options.id ?? paymentId }),
});
after(() => { delete globalThis.__floralPaymentTest; });

test("payment endpoints reject anonymous users without querying payments or invoking RPCs", async () => {
    const state = context({ user: null });
    assert.equal((await GET(new Request("https://floral.example/api/billing/payments"))).status, 401);
    assert.equal((await POST(request({ plan: "starter", cycle: "monthly", phone: "+77001234567" }))).status, 401);
    assert.equal((await patch({ action: "mark_paid" })).status, 401);
    assert.equal(state.calls.length, 0);
    assert.equal(state.queries.length, 0);
});

test("payment mutations reject cross-site requests before authentication", async () => {
    const state = context();
    assert.equal((await POST(request({}, { origin: "https://other.example" }))).status, 403);
    assert.equal((await patch({ action: "mark_paid" }, { origin: "https://other.example" })).status, 403);
    assert.equal(state.authCalls, 0);
    assert.equal(state.calls.length, 0);
});

test("requesting Kaspi payment normalizes the phone and lets the database choose owner, price and status", async () => {
    const state = context();
    for (const phone of ["+7 (700) 123-45-67", "8 700 123 45 67", "77001234567"]) {
        const response = await POST(request({ plan: "starter", cycle: "monthly", phone }, { origin: "https://floral.example" }));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.equal((await response.json()).payment.status, "requested");
    }
    assert.deepEqual(state.calls, Array.from({ length: 3 }, () => ({ name: "request_subscription_payment", args: {
        requested_plan: "starter", requested_cycle: "monthly", customer_phone: "+77001234567",
    } })));
});

test("clients cannot forge payment price, owner, activation or unknown plans and cycles", async () => {
    const state = context();
    const valid = { plan: "business", cycle: "annual", phone: "+77001234567" };
    for (const body of [null, [], {}, { ...valid, owner_id: owner }, { ...valid, amount_kzt: 1 },
        { ...valid, status: "approved" }, { ...valid, subscription: true }, { ...valid, plan: "free" },
        { ...valid, cycle: "forever" }, { ...valid, phone: "+77001234567x" }, { ...valid, phone: 77001234567 }, "bad json"]) {
        assert.equal((await POST(request(body))).status, 400);
    }
    assert.equal((await POST(request("x".repeat(2049)))).status, 413);
    assert.equal(state.calls.length, 0);
});

test("payment management is denied by the database operator check despite client editable metadata", async () => {
    const state = context({ user: { id: owner, email: "oxoiska@gmail.com", user_metadata: { role: "admin", is_subscription_operator: true } } });
    assert.equal((await GET(new Request("https://floral.example/api/billing/payments"))).status, 403);
    for (const body of [{ action: "mark_sent" }, { action: "approve", amount: 9950, reference: "KASPI-123" }, { action: "reject", reason: "Нет оплаты" }]) {
        assert.equal((await patch(body)).status, 403);
    }
    assert.equal(state.queries.length, 0);
    assert.ok(state.calls.every(({ name }) => name === "is_subscription_operator"));
});

test("operator queue is capped at 100 and filters open requests before loading rows", async () => {
    const state = context({ operator: true, rows: [payment] });
    const response = await GET(new Request("https://floral.example/api/billing/payments"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { payments: [payment], limit: 100 });
    assert.deepEqual(state.queries[0], {
        table: "subscription_payment_requests", filters: [["status", ["requested", "invoice_sent", "verification_requested"]]],
        limit: 100, ordering: [["created_at", false], ["id", false]],
    });
    assert.equal((await GET(new Request("https://floral.example/api/billing/payments?status=all"))).status, 200);
    assert.deepEqual(state.queries[1].filters, []);
    assert.equal((await GET(new Request("https://floral.example/api/billing/payments?status=approved"))).status, 400);
    assert.equal(state.queries.length, 2);
});

test("buyer paid notification requests verification without granting a subscription", async () => {
    const state = context({ operation: () => ({ data: { ...payment, status: "verification_requested" }, error: null }) });
    const response = await patch({ action: "mark_paid" });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.payment.status, "verification_requested");
    assert.equal(Object.hasOwn(result, "subscription"), false);
    assert.deepEqual(state.calls, [{ name: "change_subscription_payment", args: {
        payment_id: paymentId, requested_action: "mark_paid", received_amount: null, payment_reference: null, rejection_reason: null,
    } }]);
});

test("operator approval sends actual received amount and bank reference to the atomic database transition", async () => {
    const state = context({ operator: true, operation: () => ({ data: { ...payment, status: "approved" }, error: null }) });
    const response = await patch({ action: "approve", amount: 9950, reference: "  KASPI-123  " });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).payment.status, "approved");
    assert.deepEqual(state.calls, [{ name: "is_subscription_operator", args: undefined }, {
        name: "change_subscription_payment", args: {
            payment_id: paymentId, requested_action: "approve", received_amount: 9950, payment_reference: "KASPI-123", rejection_reason: null,
        },
    }]);
});

test("payment changes reject forged fields, invalid amounts and missing verification details", async () => {
    const state = context({ operator: true });
    for (const body of [null, [], {}, { action: "approved" }, { action: "mark_paid", status: "approved" },
        { action: "mark_sent", owner_id: owner }, { action: "approve" }, { action: "approve", amount: "9950", reference: "x" },
        { action: "approve", amount: 1.5, reference: "x" }, { action: "approve", amount: 0, reference: "x" },
        { action: "approve", amount: 9950, reference: " " }, { action: "approve", amount: 9950, reference: "x", period_end: "2099-01-01" },
        { action: "reject" }, { action: "reject", reason: " " }, { action: "reject", reason: "x", paid: false }, "bad json"]) {
        assert.equal((await patch(body)).status, 400);
    }
    assert.equal((await patch({ action: "mark_paid" }, { id: "invalid-id" })).status, 400);
    assert.equal((await patch("x".repeat(2049))).status, 413);
    assert.equal(state.calls.length, 0);
});

test("database authorization, invalid state and input errors preserve their HTTP meaning", async () => {
    for (const [code, status] of [["42501", 403], ["P0001", 409], ["22023", 400]]) {
        const state = context({ operation: () => ({ data: null, error: { code, message: "private database detail" } }) });
        const response = await patch({ action: "mark_paid" });
        assert.equal(response.status, status);
        assert.doesNotMatch(await response.text(), /private database detail/);
        assert.equal(state.calls[0].name, "change_subscription_payment");
    }
});

test("reusing a bank operation returns a conflict without exposing another buyer's payment details", async () => {
    context({ operator: true, operation: () => ({ data: null, error: {
        code: "23505", message: "duplicate key", details: "Another customer's private bank reference and owner UUID",
    } }) });
    const response = await patch({ action: "approve", amount: 9950, reference: "KASPI-123" });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "Эта операция уже использована. Проверьте номер операции в Kaspi." });
});
