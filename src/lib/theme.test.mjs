import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(await readFile(new URL("./theme.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { themeInitScript, themeStorageKey } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

function initialTheme(saved, prefersDark, storageBlocked = false) {
    const document = { documentElement: { dataset: {} } };
    runInNewContext(themeInitScript, {
        document,
        localStorage: { getItem(key) {
            assert.equal(key, themeStorageKey);
            if (storageBlocked) throw new Error("Storage is unavailable");
            return saved;
        } },
        window: { matchMedia: () => ({ matches: prefersDark }) },
    });
    return document.documentElement.dataset.theme;
}

test("saved theme takes priority over the device theme before hydration", () => {
    assert.equal(initialTheme("light", true), "light");
    assert.equal(initialTheme("dark", false), "dark");
});

test("a first visit or invalid saved value uses the device theme", () => {
    for (const saved of [null, "", "unknown"]) {
        assert.equal(initialTheme(saved, true), "dark");
        assert.equal(initialTheme(saved, false), "light");
    }
});

test("private browsing with blocked storage still applies a usable theme", () => {
    assert.equal(initialTheme(null, true, true), "dark");
    assert.equal(initialTheme(null, false, true), "light");
});
