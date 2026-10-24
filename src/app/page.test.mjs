import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Module from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import ts from "typescript";

const filename = fileURLToPath(new URL("./page.tsx", import.meta.url));
const compiled = ts.transpileModule(await readFile(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const originalWindow = globalThis.window;
let dispose;
afterEach(() => { dispose?.(); globalThis.window = originalWindow; });
const flush = () => new Promise(setImmediate);

// Exercise the real component's handlers with controlled timers so replies can
// arrive in a different order from business tab selections.
function mount() {
    const hooks = [], timers = new Map();
    let cursor = 0, timerId = 0, tree, effects = [], queued = false, disposed = false;
    const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
    const react = {
        useState(initial) {
            const hook = hooks[cursor++] ??= { value: typeof initial === "function" ? initial() : initial };
            return [hook.value, (action) => {
                hook.value = typeof action === "function" ? action(hook.value) : action;
                if (!queued && !disposed) {
                    queued = true;
                    queueMicrotask(() => { queued = false; if (!disposed) render(); });
                }
            }];
        },
        useRef(initial) { return (hooks[cursor++] ??= { value: { current: initial } }).value; },
        useEffect(effect, deps) {
            const index = cursor++;
            if (!same(hooks[index]?.deps, deps)) effects.push(() => {
                hooks[index]?.cleanup?.();
                hooks[index] = { deps, cleanup: effect() };
            });
        },
    };
    globalThis.window = {
        setTimeout: (callback) => { const id = ++timerId; timers.set(id, callback); return id; },
        clearTimeout: (id) => timers.delete(id),
    };
    const module = new Module(filename);
    module.paths = Module._nodeModulePaths(process.cwd());
    const require = module.require.bind(module);
    module.require = (specifier) => {
        if (specifier === "react") return react;
        if (specifier === "lucide-react") return new Proxy({}, { get: () => () => null });
        if (specifier === "next/link") return () => null;
        if (specifier === "@/components/language-provider") return { useLanguage: () => ({ t: (text) => text }) };
        if (specifier.startsWith("@/") || specifier.endsWith(".css")) return {};
        return require(specifier);
    };
    module._compile(`${compiled}\nexports.TestChatDemo = ChatDemo;`, filename);
    const Component = module.exports.TestChatDemo;
    function render() {
        cursor = 0; effects = [];
        tree = Component({});
        effects.forEach((effect) => effect());
    }
    function nodes(node) {
        if (!node || typeof node !== "object") return [];
        if (Array.isArray(node)) return node.flatMap(nodes);
        return [node, ...nodes(node.props?.children)];
    }
    function text(node) {
        if (typeof node === "string" || typeof node === "number") return String(node);
        if (Array.isArray(node)) return node.map(text).join("");
        return node?.props ? text(node.props.children) : "";
    }
    const find = (predicate) => { const node = nodes(tree).find(predicate); assert.ok(node); return node; };
    dispose = () => { disposed = true; hooks.forEach((hook) => hook?.cleanup?.()); };
    render();
    return {
        select(label) { find((node) => node.type === "button" && text(node) === label).props.onClick(); },
        input(value) { find((node) => node.type === "input").props.onChange({ target: { value } }); },
        value: () => find((node) => node.type === "input").props.value,
        submit() { find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }); },
        log: () => text(find((node) => node.props?.role === "log")),
        typing: () => find((node) => node.props?.role === "log").props["aria-busy"],
        pending: () => timers.size,
        replyLast() { const [id, callback] = [...timers.entries()].at(-1); timers.delete(id); callback(); },
    };
}

test("switching businesses while replies are pending keeps each answer in its own conversation", async () => {
    const ui = mount();
    ui.input("How much is a haircut?"); await flush();
    ui.submit(); ui.submit(); await flush();
    assert.equal(ui.pending(), 1, "rapid duplicate submits are ignored");
    ui.select("Shop"); await flush();
    assert.equal(ui.typing(), false);
    assert.doesNotMatch(ui.log(), /haircut/);
    ui.input("How long is delivery?"); await flush();
    ui.submit(); await flush();
    ui.replyLast(); await flush();
    assert.match(ui.log(), /1–2 business days/);
    ui.replyLast(); await flush();
    assert.doesNotMatch(ui.log(), /8,000/);
    ui.select("Beauty"); await flush();
    assert.match(ui.log(), /haircut/);
    assert.match(ui.log(), /8,000/);
    assert.doesNotMatch(ui.log(), /1–2 business days/);
    assert.equal(ui.typing(), false);
});

test("business tab changes retain unsent drafts and unmount cancels pending replies", async () => {
    const ui = mount();
    ui.input("My unfinished question"); await flush();
    ui.select("Shop"); await flush();
    assert.equal(ui.value(), "");
    ui.input("A different draft"); await flush();
    ui.select("Beauty"); await flush();
    assert.equal(ui.value(), "My unfinished question");
    ui.submit(); await flush();
    assert.equal(ui.pending(), 1);
    dispose();
    assert.equal(ui.pending(), 0);
});
