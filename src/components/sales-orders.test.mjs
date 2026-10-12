import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Module from "node:module";
import { afterEach, test } from "node:test";
import ts from "typescript";

const filename = new URL("./sales-orders.tsx", import.meta.url);
const code = ts.transpileModule(await readFile(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const original = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document };
let cleanup;
afterEach(() => { cleanup?.(); Object.assign(globalThis, original); });

// Drive the real component's handlers and effects with deterministic browser events and fetches.
// No database fixtures or Telegram messages are created by these interaction tests.
function mount(fetcher) {
    const hooks = [];
    const intervals = new Map();
    let hookIndex = 0, queued = false, disposed = false, tree, effects = [];
    const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
    const schedule = () => {
        if (queued || disposed) return;
        queued = true;
        queueMicrotask(() => { queued = false; if (!disposed) render(); });
    };
    const react = {
        useState(initial) {
            const index = hookIndex++;
            const hook = hooks[index] ??= { value: typeof initial === "function" ? initial() : initial };
            return [hook.value, (action) => {
                const value = typeof action === "function" ? action(hook.value) : action;
                if (!Object.is(value, hook.value)) { hook.value = value; schedule(); }
            }];
        },
        useRef(initial) { return (hooks[hookIndex++] ??= { value: { current: initial } }).value; },
        useCallback(callback, dependencies) {
            const index = hookIndex++;
            if (!same(hooks[index]?.dependencies, dependencies)) hooks[index] = { value: callback, dependencies };
            return hooks[index].value;
        },
        useEffect(effect, dependencies) {
            const index = hookIndex++;
            if (!same(hooks[index]?.dependencies, dependencies)) effects.push(() => {
                hooks[index]?.cleanup?.();
                hooks[index] = { dependencies, cleanup: effect() };
            });
        },
    };
    const compiled = new Module(filename.pathname);
    compiled.paths = Module._nodeModulePaths(process.cwd());
    const require = compiled.require.bind(compiled);
    compiled.require = (name) => name === "react" ? react : require(name);
    compiled._compile(code, filename.pathname);
    const window = new EventTarget();
    window.setInterval = (callback) => { const id = intervals.size + 1; intervals.set(id, callback); return id; };
    window.clearInterval = (id) => intervals.delete(id);
    globalThis.window = window;
    globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
    globalThis.fetch = fetcher;
    function render() {
        hookIndex = 0; effects = [];
        tree = compiled.exports.SalesOrders();
        for (const effect of effects) effect();
    }
    function nodes(value) {
        if (!value || typeof value !== "object") return [];
        if (Array.isArray(value)) return value.flatMap((child) => nodes(child));
        return [value, ...nodes(value.props?.children)];
    }
    function text(value) {
        if (typeof value === "string" || typeof value === "number") return String(value);
        if (Array.isArray(value)) return value.map(text).join("");
        return value?.props ? text(value.props.children) : "";
    }
    cleanup = () => { disposed = true; for (const hook of hooks) hook?.cleanup?.(); };
    render();
    return {
        text: () => text(tree),
        cards: () => nodes(tree).filter((node) => node.type === "article").map((node) => text(node)),
        click(label) {
            const button = nodes(tree).find((node) => node.type === "button" && text(node) === label);
            assert.ok(button, `button ${label} exists`);
            assert.ok(!button.props.disabled, `button ${label} is enabled`);
            button.props.onClick();
        },
        poll: () => { for (const callback of intervals.values()) callback(); },
    };
}

const flush = async () => { for (let count = 0; count < 8; count++) await new Promise(setImmediate); };
const idFor = (number) => `40000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const order = (number, status = "awaiting_confirmation") => ({
    id: idFor(number), created_at: "2026-10-13T05:30:12.123456+00:00", status,
    customer_name: `Клиент ${number}`, customer_phone: "+77771234567", delivery_address: "Алматы, Абая 12",
    delivery_date: "Завтра после 15:00", product_name: `Букет ${number}`, product_price_kzt: 12000,
    delivery_fee_kzt: null, total_kzt: null, occasion: "Подарок", note: "Открытка",
});
function storageFetch(rows, requests = []) {
    return async (path, options = {}) => {
        const url = new URL(path, "https://floral.example");
        requests.push({ url, options });
        if (options.method === "PATCH") {
            const { id, status } = JSON.parse(options.body);
            const existing = rows.find((row) => row.id === id);
            existing.status = status;
            return Response.json({ order: existing });
        }
        const status = url.searchParams.get("status");
        const after = url.searchParams.get("after");
        const cursor = after ? JSON.parse(Buffer.from(after, "base64url").toString("utf8")) : null;
        const eligible = rows.filter((row) => !status || row.status === status)
            .filter((row) => !cursor || row.created_at < cursor.created_at || (row.created_at === cursor.created_at && row.id < cursor.id))
            .toSorted((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id));
        const page = eligible.slice(0, 50);
        const last = page.at(-1);
        return Response.json({ orders: page, nextCursor: eligible.length > 50
            ? Buffer.from(JSON.stringify({ created_at: last.created_at, id: last.id })).toString("base64url") : null });
    };
}

test("owner sees incoming orders automatically, can start and finish them with their details intact", async () => {
    const rows = [order(1)];
    const requests = [];
    const ui = mount(storageFetch(rows, requests));
    await flush();
    assert.equal(ui.cards().length, 1);
    assert.match(ui.cards()[0], /Заявка № 40000000/);
    assert.match(ui.cards()[0], /Клиент 1.*\+77771234567.*Алматы, Абая 12/);
    rows.push(order(2));
    ui.poll();
    await flush();
    assert.equal(ui.cards().length, 2);
    assert.match(ui.cards()[0], /Букет 2/);
    ui.click("Новые");
    await flush();
    const start = requests.length;
    // Both cards have a start button; the first starts the newest request.
    ui.click("Приступить");
    await flush();
    assert.equal(rows.find((row) => row.id === idFor(2)).status, "confirmed");
    assert.equal(ui.cards().length, 1, "started order leaves the New filter immediately");
    assert.deepEqual(JSON.parse(requests[start].options.body), { id: idFor(2), status: "confirmed" });
    ui.click("В процессе");
    await flush();
    assert.match(ui.cards()[0], /В процессе/);
    ui.click("Отметить выполненной");
    await flush();
    ui.click("Выполненные");
    await flush();
    assert.match(ui.cards()[0], /Выполнена/);
    assert.doesNotMatch(ui.cards()[0], /Приступить|Отметить выполненной|Отменить/);
});

test("a late response from an old filter cannot overwrite the current status view", async () => {
    let completeOld;
    const rows = [order(1), order(2, "confirmed")];
    const fetcher = storageFetch(rows);
    const ui = mount((url, options) => url === "/api/orders" ? new Promise((resolve) => { completeOld = resolve; }) : fetcher(url, options));
    ui.click("В процессе");
    await flush();
    assert.equal(ui.cards().length, 1);
    assert.match(ui.cards()[0], /Букет 2/);
    completeOld(Response.json({ orders: [order(1)], nextCursor: null }));
    await flush();
    assert.equal(ui.cards().length, 1);
    assert.match(ui.cards()[0], /Букет 2/);
});

test("polling preserves loaded older pages and the next cursor when incoming requests fill a page", async () => {
    const rows = Array.from({ length: 125 }, (_, index) => order(index + 1));
    const ui = mount(storageFetch(rows));
    await flush();
    ui.click("Новые");
    await flush();
    ui.click("Показать ещё");
    await flush();
    assert.equal(ui.cards().length, 100);
    rows.push(...Array.from({ length: 51 }, (_, index) => order(126 + index)));
    rows.find((row) => row.id === idFor(50)).status = "confirmed";
    ui.poll();
    await flush();
    assert.equal(ui.cards().length, 150, "51 new orders added, one changed status removed, older displayed rows retained");
    assert.match(ui.cards().at(-1), /Букет 26/);
    ui.click("Показать ещё");
    await flush();
    assert.equal(ui.cards().length, 175);
    assert.match(ui.cards().at(-1), /Букет 1/);
    assert.doesNotMatch(ui.text(), /Показать ещё/);
});
