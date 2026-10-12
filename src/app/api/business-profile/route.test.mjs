import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const compile = (source) => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const businessUrl = url(compile(await readFile(new URL("../../../lib/business.ts", import.meta.url), "utf8")));
const nextUrl = url("export const NextResponse = { json: (body, init) => Response.json(body, init) };");
const serverUrl = url("export const createSupabaseServerClient = async () => globalThis.__businessProfileTest.client;");
const source = compile(await readFile(new URL("./route.ts", import.meta.url), "utf8"))
    .replaceAll('"next/server"', JSON.stringify(nextUrl))
    .replaceAll('"@/lib/business"', JSON.stringify(businessUrl))
    .replaceAll('"@/lib/supabase/server"', JSON.stringify(serverUrl));
const api = await import(url(source));
const profile = { name: "Цветы", category: "Retail & online shop", description: "Букеты",
    location: "Алматы", hours: "09–20", phone: "", language: "Russian", tone: "Friendly", services: [] };

function setup({ user = { id: "verified-owner" }, error = null, accessError = null, access = (id) => id === "verified-owner" } = {}) {
    const context = { filters: [], writes: [], reads: 0, rpcCalls: [], tables: [] };
    const query = {
        select() { return query; },
        eq(...filter) { context.filters.push(filter); return query; },
        upsert(value, options) { context.writes.push({ value, options }); return query; },
        async single() { return { data: context.writes.at(-1)?.value, error }; },
        async maybeSingle() { context.reads++; return { data: { profile }, error }; },
    };
    context.client = { auth: { getUser: async () => ({ data: { user }, error: null }) },
        rpc(name, args) {
            assert.equal(name, "has_workspace_access");
            context.rpcCalls.push({ name, args });
            return Promise.resolve({ data: access(user?.id), error: accessError });
        },
        from(table) { context.tables.push(table); assert.equal(table, "business_profiles"); return query; } };
    globalThis.__businessProfileTest = context;
    return context;
}
after(() => { delete globalThis.__businessProfileTest; });
const put = (body, origin = "https://floral.example") => new Request("https://floral.example/api/business-profile", {
    method: "PUT", headers: { Origin: origin }, body: JSON.stringify(body),
});

test("business profile requires a verified account before reads or writes", async () => {
    const context = setup({ user: null });
    assert.equal((await api.GET()).status, 401);
    assert.equal((await api.PUT(put({ profile }))).status, 401);
    assert.equal(context.reads, 0);
    assert.deepEqual(context.writes, []);
    assert.deepEqual(context.rpcCalls, []);
});

test("expired account cannot borrow access with forged ownership or write the profile", async () => {
    const context = setup({ user: { id: "expired-owner" } });
    const response = await api.PUT(put({ owner_id: "verified-owner", hasAccess: true, profile }));
    assert.equal(response.status, 402);
    assert.equal((await response.json()).code, "SUBSCRIPTION_REQUIRED");
    assert.deepEqual(context.rpcCalls, [{ name: "has_workspace_access", args: undefined }]);
    assert.deepEqual(context.tables, []);
    assert.deepEqual(context.writes, []);
    assert.equal(context.reads, 0);
});

test("existing profile remains readable after the subscription expires", async () => {
    const context = setup({ user: { id: "expired-owner" } });
    const response = await api.GET();
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).profile, profile);
    assert.deepEqual(context.filters, [["owner_id", "expired-owner"]]);
    assert.deepEqual(context.rpcCalls, []);
    assert.deepEqual(context.writes, []);
});

test("profile saving fails closed before data writes when access verification is unavailable", async () => {
    for (const options of [{ accessError: { code: "rpc-unavailable" } }, { access: () => null }]) {
        const context = setup(options);
        const response = await api.PUT(put({ profile }));
        assert.equal(response.status, 503);
        assert.match((await response.json()).error, /Не удалось проверить доступ/);
        assert.deepEqual(context.tables, []);
        assert.deepEqual(context.writes, []);
        assert.equal(context.reads, 0);
    }
});

test("business profile reads and upserts derive ownership from the verified user", async () => {
    const context = setup();
    const get = await api.GET();
    assert.match(get.headers.get("cache-control"), /no-store/);
    assert.deepEqual(context.filters, [["owner_id", "verified-owner"]]);
    const response = await api.PUT(put({ owner_id: "forged", profile: { ...profile, owner_id: "forged" } }));
    assert.equal(response.status, 200);
    assert.equal(context.writes[0].value.owner_id, "verified-owner");
    assert.equal(Object.hasOwn(context.writes[0].value.profile, "owner_id"), false);
    assert.deepEqual(context.writes[0].options, { onConflict: "owner_id" });
});

test("profile refuses cross-origin or invalid data and never reports failed writes as saved", async () => {
    const context = setup({ error: { code: "storage-unavailable" } });
    assert.equal((await api.PUT(put({ profile }, "https://other.example"))).status, 403);
    assert.equal((await api.PUT(put({ profile: { ...profile, name: "" } }))).status, 400);
    assert.deepEqual(context.writes, []);
    const response = await api.PUT(put({ profile }));
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(Object.hasOwn(result, "profile"), false);
    assert.match(result.error, /Не удалось сохранить/);
});
