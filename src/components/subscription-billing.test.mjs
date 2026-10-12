import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Module from "node:module";
import { afterEach, test } from "node:test";
import ts from "typescript";

const sourceFiles = {
    billing: new URL("./subscription-billing.tsx", import.meta.url),
    payments: new URL("./subscription-payments.tsx", import.meta.url),
    plans: new URL("../lib/plans.ts", import.meta.url),
};
const compiledSources = Object.fromEntries(await Promise.all(Object.entries(sourceFiles).map(async ([name, file]) => [name,
    ts.transpileModule(await readFile(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
])));
const original = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document };
let cleanup;
afterEach(() => { cleanup?.(); Object.assign(globalThis, original); });

// Run the real customer and operator components, including their child forms,
// with deterministic hooks, browser events and network responses.
function mount(fetcher) {
    const instances = new Map();
    const intervals = new Map();
    const modules = new Map();
    let current, tree, queued = false, disposed = false, effects = [], intervalId = 0;
    const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
    const schedule = () => {
        if (queued || disposed) return;
        queued = true;
        queueMicrotask(() => { queued = false; if (!disposed) render(); });
    };
    const react = {
        useState(initial) {
            const hook = current.hooks[current.index++] ??= { value: typeof initial === "function" ? initial() : initial };
            return [hook.value, (action) => {
                const value = typeof action === "function" ? action(hook.value) : action;
                if (!Object.is(value, hook.value)) { hook.value = value; schedule(); }
            }];
        },
        useRef(initial) { return (current.hooks[current.index++] ??= { value: { current: initial } }).value; },
        useEffect(effect, dependencies) {
            const instance = current;
            const index = instance.index++;
            if (!same(instance.hooks[index]?.dependencies, dependencies)) effects.push(() => {
                instance.hooks[index]?.cleanup?.();
                instance.hooks[index] = { dependencies, cleanup: effect() };
            });
        },
    };
    function load(name) {
        if (modules.has(name)) return modules.get(name).exports;
        const file = sourceFiles[name];
        const compiled = new Module(file.pathname);
        compiled.paths = Module._nodeModulePaths(process.cwd());
        modules.set(name, compiled);
        const require = compiled.require.bind(compiled);
        compiled.require = (specifier) => {
            if (specifier === "react") return react;
            if (specifier === "lucide-react") return new Proxy({}, { get: () => () => null });
            if (specifier === "@/lib/plans") return load("plans");
            if (specifier === "@/components/subscription-payments") return load("payments");
            if (specifier.endsWith(".css")) return {};
            return require(specifier);
        };
        compiled._compile(compiledSources[name], file.pathname);
        return compiled.exports;
    }
    const component = load("billing").SubscriptionBilling;
    const browser = new EventTarget();
    browser.setInterval = (callback) => { const id = ++intervalId; intervals.set(id, callback); return id; };
    browser.clearInterval = (id) => intervals.delete(id);
    globalThis.window = browser;
    globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
    globalThis.fetch = fetcher;
    let seen;
    function expand(node, path) {
        if (!node || typeof node !== "object") return node;
        if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}/${child?.key ?? index}`));
        if (typeof node.type === "function") {
            const key = `${path}:${node.type.name}`;
            seen.add(key);
            const instance = instances.get(key) ?? { hooks: [], index: 0 };
            instances.set(key, instance);
            instance.index = 0;
            const previous = current;
            current = instance;
            const result = node.type(node.props);
            current = previous;
            return expand(result, `${path}/render`);
        }
        return node.props ? { ...node, props: { ...node.props, children: expand(node.props.children, `${path}/children`) } } : node;
    }
    function render() {
        effects = []; seen = new Set();
        tree = expand({ type: component, props: {} }, "root");
        for (const [key, instance] of instances) if (!seen.has(key)) {
            for (const hook of instance.hooks) hook?.cleanup?.();
            instances.delete(key);
        }
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
    const button = (label) => {
        const result = nodes(tree).find((node) => node.type === "button" && text(node).trim() === label);
        assert.ok(result, `button ${label} exists`);
        return result;
    };
    cleanup = () => { disposed = true; for (const instance of instances.values()) for (const hook of instance.hooks) hook?.cleanup?.(); };
    render();
    return {
        text: () => text(tree),
        disabled: (label) => !!button(label).props.disabled,
        click(label) {
            const target = button(label);
            assert.ok(!target.props.disabled, `button ${label} is enabled`);
            target.props.onClick();
        },
        change(label, value) {
            const wrapper = nodes(tree).find((node) => node.type === "label" && text(node).startsWith(label));
            assert.ok(wrapper, `field ${label} exists`);
            const input = nodes(wrapper).find((node) => ["input", "select", "textarea"].includes(node.type));
            assert.ok(input && !input.props.disabled, `field ${label} is enabled`);
            input.props.onChange({ target: { value, checked: value } });
        },
        submit(label) {
            assert.ok(!button(label).props.disabled, `submit ${label} is enabled`);
            const form = nodes(tree).find((node) => node.type === "form" && nodes(node).some((child) => child.type === "button" && text(child).trim() === label));
            assert.ok(form, `form for ${label} exists`);
            form.props.onSubmit({ preventDefault() {} });
        },
        poll: () => { for (const callback of [...intervals.values()]) callback(); },
    };
}

const flush = async () => { for (let count = 0; count < 8; count++) await new Promise(setImmediate); };
const paymentId = "20000000-0000-4000-8000-000000000001";
const trial = { startedAt: "2026-10-13T10:00:00Z", endsAt: "2026-10-20T10:00:00Z", state: "trialing", daysRemaining: 7, selectedPlan: "starter" };
function payment(status = "requested", overrides = {}) {
    return {
        id: paymentId, owner_id: "10000000-0000-4000-8000-000000000001", owner_email: "shop@example.com",
        plan: "starter", billing_cycle: "monthly", amount_kzt: 9950, kaspi_phone: "+77771234567", status,
        bank_reference: null, rejection_reason: null, approved_at: null,
        created_at: "2026-10-13T10:00:00Z", updated_at: "2026-10-13T10:00:00Z", ...overrides,
    };
}
function server({ operator = false, initialPayment = null } = {}) {
    const state = { payment: initialPayment, subscription: null, calls: [] };
    state.billing = () => ({ trial, subscription: state.subscription, paymentRequest: state.payment, paymentsAvailable: true, canManagePayments: operator });
    state.fetch = async (path, options = {}) => {
        state.calls.push({ path, options });
        if (path === "/api/billing") return Response.json(state.billing());
        if (path.startsWith("/api/billing/payments?")) {
            assert.ok(operator, "buyers must never fetch the operator queue");
            const all = new URL(path, "https://floral.example").searchParams.get("status") === "all";
            return Response.json({ payments: state.payment && (all || !["approved", "rejected"].includes(state.payment.status)) ? [state.payment] : [], limit: 100 });
        }
        if (path === "/api/billing/payments" && options.method === "POST") {
            const body = JSON.parse(options.body);
            const monthly = body.plan === "starter" ? 9950 : 24950;
            state.payment = payment("requested", { plan: body.plan, billing_cycle: body.cycle, kaspi_phone: body.phone,
                amount_kzt: body.cycle === "annual" ? monthly * 12 * 0.8 : monthly });
            return Response.json({ payment: state.payment });
        }
        if (path === `/api/billing/payments/${paymentId}` && options.method === "PATCH") {
            const body = JSON.parse(options.body);
            const status = { mark_sent: "invoice_sent", mark_paid: "verification_requested", approve: "approved", reject: "rejected" }[body.action];
            state.payment = { ...state.payment, status, bank_reference: body.reference ?? null, rejection_reason: body.reason ?? null };
            if (body.action === "approve") state.subscription = { plan: state.payment.plan, periodStartsAt: "2026-10-20T10:00:00Z", periodEndsAt: "2026-11-20T10:00:00Z", state: "scheduled" };
            return Response.json({ payment: state.payment });
        }
        throw new Error(`Unexpected network call ${options.method ?? "GET"} ${path}`);
    };
    return state;
}

test("buyer can select an annual plan, see the discounted total and request a Kaspi invoice without entering a card", async () => {
    const state = server();
    const ui = mount(state.fetch);
    await flush();
    assert.doesNotMatch(ui.text(), /Управление оплатой FloralAI/);
    ui.click("Выбрать Business");
    await flush();
    ui.change("Период оплаты", "annual");
    ui.change("Номер телефона Kaspi", "8 (777) 123-45-67");
    await flush();
    assert.match(ui.text(), /239\s520 ₸/);
    ui.submit("Запросить счёт Kaspi");
    await flush();
    const mutation = state.calls.find(({ options }) => options.method === "POST");
    assert.deepEqual(JSON.parse(mutation.options.body), { plan: "business", cycle: "annual", phone: "+77771234567" });
    assert.match(ui.text(), /Ждёт выставления счёта/);
    assert.match(ui.text(), /Дождитесь сообщения в приложении Kaspi.kz/);
    assert.doesNotMatch(ui.text(), /Подписка активна|Управление оплатой FloralAI/);
    assert.ok(ui.disabled("Выбрать Starter"), "an open invoice prevents choosing a different price");
});

test("buyer monthly invoice uses the displayed price and validates the Kaspi phone before a network mutation", async () => {
    const state = server();
    const ui = mount(state.fetch);
    await flush();
    ui.change("Номер телефона Kaspi", "123");
    await flush();
    ui.submit("Запросить счёт Kaspi");
    await flush();
    assert.match(ui.text(), /Укажите номер Kaspi в формате/);
    assert.equal(state.calls.some(({ options }) => options.method === "POST"), false);
    ui.change("Номер телефона Kaspi", "+7 777 123 45 67");
    await flush();
    ui.submit("Запросить счёт Kaspi");
    await flush();
    assert.deepEqual(JSON.parse(state.calls.find(({ options }) => options.method === "POST").options.body), {
        plan: "starter", cycle: "monthly", phone: "+77771234567",
    });
    assert.equal(state.payment.amount_kzt, 9950);
});

test("Я оплатил sends a verification request while paid access waits for bank confirmation", async () => {
    const state = server({ initialPayment: payment("invoice_sent") });
    const ui = mount(state.fetch);
    await flush();
    ui.click("Я оплатил — отправить на проверку");
    await flush();
    assert.deepEqual(JSON.parse(state.calls.find(({ options }) => options.method === "PATCH").options.body), { action: "mark_paid" });
    assert.match(ui.text(), /Проверяем оплату/);
    assert.match(ui.text(), /Подписка активируется после подтверждения поступления денег/);
    assert.doesNotMatch(ui.text(), /Подписка активна|Подписка оплачена/);
    assert.equal(state.subscription, null);
});

test("operator sends the invoice, then needs the exact received amount, reference and bank verification to approve", async () => {
    const state = server({ operator: true, initialPayment: payment("requested") });
    const ui = mount(state.fetch);
    await flush();
    assert.match(ui.text(), /Управление оплатой FloralAI/);
    ui.click("Счёт выставлен в Kaspi");
    await flush();
    assert.deepEqual(JSON.parse(state.calls.find(({ options }) => options.method === "PATCH").options.body), { action: "mark_sent" });
    assert.ok(ui.disabled("Подтвердить оплату и подписку"));
    ui.change("Номер операции в Kaspi", "KASPI-123");
    await flush();
    assert.ok(ui.disabled("Подтвердить оплату и подписку"), "a reference alone is not bank verification");
    ui.change("Я проверил поступление", true);
    ui.change("Фактически получено", "1000");
    await flush();
    ui.submit("Подтвердить оплату и подписку");
    await flush();
    assert.match(ui.text(), /должно поступить ровно 9\s950 ₸/);
    assert.equal(state.calls.filter(({ options }) => options.method === "PATCH").length, 1);
    ui.change("Фактически получено", "9950");
    await flush();
    ui.submit("Подтвердить оплату и подписку");
    await flush();
    const approvals = state.calls.filter(({ options }) => options.method === "PATCH");
    assert.deepEqual(JSON.parse(approvals[1].options.body), { action: "approve", amount: 9950, reference: "KASPI-123" });
    assert.match(ui.text(), /Подписка оплачена/);
    assert.match(ui.text(), /Бесплатная неделя сохраняется полностью/);
    assert.match(ui.text(), /Счетов, требующих действий, пока нет/);
});

test("late background billing data cannot erase a newly requested invoice", async () => {
    const state = server();
    let completeOld, oldSignal, reads = 0;
    const ui = mount((path, options = {}) => {
        if (path === "/api/billing" && ++reads === 2) {
            oldSignal = options.signal;
            const stale = state.billing();
            return new Promise((resolve) => { completeOld = () => resolve(Response.json(stale)); });
        }
        return state.fetch(path, options);
    });
    await flush();
    ui.poll();
    await flush();
    assert.ok(completeOld, "the background GET is still pending");
    ui.change("Номер телефона Kaspi", "+77771234567");
    await flush();
    ui.submit("Запросить счёт Kaspi");
    await flush();
    assert.equal(oldSignal.aborted, true);
    assert.match(ui.text(), /Ждёт выставления счёта/);
    completeOld();
    await flush();
    assert.match(ui.text(), /Ждёт выставления счёта/);
});
