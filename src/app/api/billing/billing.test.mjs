import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import ts from "typescript";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const transpile = (source) => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const subscriptionUrl = moduleUrl(transpile(await readFile(new URL("../../../lib/subscription.ts", import.meta.url), "utf8")));
const serverUrl = moduleUrl("export const createSupabaseServerClient = async () => globalThis.__floralBillingTest.client;");
const nextUrl = moduleUrl("export const NextResponse = {json: (body, init) => new Response(JSON.stringify(body), {...init, headers: {'content-type': 'application/json', ...init?.headers}})};");
async function loadRoute(path) {
    const source = transpile(await readFile(new URL(path, import.meta.url), "utf8"))
        .replaceAll('"next/server"', JSON.stringify(nextUrl))
        .replaceAll('"@/lib/supabase/server"', JSON.stringify(serverUrl))
        .replaceAll('"@/lib/subscription"', JSON.stringify(subscriptionUrl));
    return import(moduleUrl(source));
}
const { GET } = await loadRoute("./route.ts");
const { POST } = await loadRoute("./trial/route.ts");
const { describeTrial } = await import(subscriptionUrl);
const owner = "10000000-0000-4000-8000-000000000001";

function context({ user = { id: owner }, row = null, subscription = null, payment = null, operator = false } = {}) {
    const state = { reads: [], calls: [], row };
    state.client = {
        auth: { getUser: async () => ({ data: { user }, error: null }) },
        from(table) {
            const filters = [];
            return {
                select() { return this; },
                eq(column, value) { filters.push([column, value]); return this; },
                order() { return this; },
                limit() { return this; },
                async maybeSingle() {
                    state.reads.push({ table, filters });
                    return { data: table === "business_trials" ? state.row
                        : table === "business_subscriptions" ? subscription : payment, error: null };
                },
            };
        },
        rpc(name, args) {
            if (name === "is_subscription_operator") return Promise.resolve({ data: operator, error: null });
            state.calls.push({ name, args });
            state.row ??= {
                started_at: new Date().toISOString(),
                ends_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
                selected_plan: args.requested_plan,
            };
            return { returns() { return this; }, single: async () => ({ data: state.row, error: null }) };
        },
    };
    globalThis.__floralBillingTest = state;
    return state;
}
const request = (body, origin) => new Request("https://floral.example/api/billing/trial", {
    method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
    headers: origin ? { origin } : {},
});
after(() => { delete globalThis.__floralBillingTest; });

test("trial status expires at the exact server deadline", () => {
    const row = { started_at: "2026-10-13T10:00:00Z", ends_at: "2026-10-20T10:00:00Z", selected_plan: "starter" };
    assert.equal(describeTrial(row, Date.parse(row.started_at)).daysRemaining, 7);
    assert.equal(describeTrial(row, Date.parse(row.ends_at) - 1).daysRemaining, 1);
    assert.equal(describeTrial(row, Date.parse(row.ends_at)).state, "expired");
    assert.equal(describeTrial(row, Date.parse(row.ends_at) + 1).daysRemaining, 0);
    assert.equal(describeTrial(null), null);
});

test("billing endpoints reject anonymous users before reads or trial creation", async () => {
    const state = context({ user: null });
    assert.equal((await GET()).status, 401);
    assert.equal((await POST(request({ plan: "starter" }))).status, 401);
    assert.equal(state.reads.length, 0);
    assert.equal(state.calls.length, 0);
});

test("billing GET reads only the verified owner and never starts a trial", async () => {
    const state = context();
    const response = await GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const result = await response.json();
    assert.equal(result.trial, null);
    assert.equal(result.subscription, null);
    assert.equal(result.paymentRequest, null);
    assert.equal(result.canManagePayments, false);
    assert.equal(result.paymentsAvailable, true);
    assert.deepEqual(state.reads, ["business_trials", "business_subscriptions", "subscription_payment_requests"]
        .map((table) => ({ table, filters: [["owner_id", owner]] })));
    assert.equal(state.calls.length, 0);
});

test("trial creation passes only the selected plan to the authenticated atomic RPC", async () => {
    const state = context();
    const response = await POST(request({ plan: "starter" }, "https://floral.example"));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.trial.selectedPlan, "starter");
    assert.equal(result.trial.state, "trialing");
    assert.equal(result.trial.daysRemaining, 7);
    assert.equal(result.paymentsAvailable, true);
    assert.deepEqual(state.calls, [{ name: "start_business_trial", args: { requested_plan: "starter" } }]);
});

test("repeated start returns the original expired trial without restarting its free week", async () => {
    const row = { started_at: "2020-01-01T00:00:00Z", ends_at: "2020-01-08T00:00:00Z", selected_plan: "starter" };
    context({ row });
    const response = await POST(request({ plan: "business" }));
    const result = await response.json();
    assert.equal(result.trial.startedAt, row.started_at);
    assert.equal(result.trial.endsAt, row.ends_at);
    assert.equal(result.trial.selectedPlan, "starter");
    assert.equal(result.trial.state, "expired");
    assert.equal(result.paymentsAvailable, true);
});

test("payment verification alone does not turn into a paid subscription in billing status", async () => {
    const payment = { id: "20000000-0000-4000-8000-000000000001", status: "verification_requested" };
    context({ payment });
    const result = await (await GET()).json();
    assert.equal(result.subscription, null);
    assert.deepEqual(result.paymentRequest, payment);
});

test("billing reports a scheduled paid period from the approved subscription record", async () => {
    context({ operator: true, subscription: { plan: "business", period_start: "2099-01-01T00:00:00Z", period_end: "2099-02-01T00:00:00Z" } });
    const result = await (await GET()).json();
    assert.equal(result.canManagePayments, true);
    assert.deepEqual(result.subscription, {
        plan: "business", periodStartsAt: "2099-01-01T00:00:00Z", periodEndsAt: "2099-02-01T00:00:00Z", state: "scheduled",
    });
});

test("trial creation rejects cross-site requests before authentication", async () => {
    const state = context();
    assert.equal((await POST(request({ plan: "business" }, "https://other.example"))).status, 403);
    assert.equal(state.calls.length, 0);
});

test("clients cannot supply an owner, extend dates, forge payment, or choose unknown plans", async () => {
    const state = context();
    for (const body of [null, [], {}, { plan: "free" }, { plan: "business", owner_id: owner },
        { plan: "business", ends_at: "2099-01-01" }, { plan: "business", paid: true }, "bad json"]) {
        assert.equal((await POST(request(body))).status, 400);
    }
    assert.equal((await POST(request("x".repeat(1025)))).status, 413);
    assert.equal(state.calls.length, 0);
});
