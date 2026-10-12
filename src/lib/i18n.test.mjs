import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("./i18n.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { defaultLocale, isLocale, localeNames, supportedLocales, translate, translateError } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("lists a display name for every supported locale", () => {
    assert.deepEqual(Object.keys(localeNames), [...supportedLocales]);
    assert.deepEqual(supportedLocales, ["en", "ru", "kk"]);
});

test("recognizes supported locales and rejects unknown values", () => {
    for (const locale of supportedLocales) {
        assert.equal(isLocale(locale), true);
    }
    assert.equal(isLocale(null), false);
    assert.equal(isLocale("fr"), false);
});

test("translates interactive demo accessibility labels", () => {
    assert.equal(translate("ru", "Choose demo business"), "Выберите демо-бизнес");
    assert.equal(translate("kk", "Conversation"), "Әңгіме");
    assert.equal(translate("ru", "Assistant is typing"), "Ассистент печатает");
});

test("falls back to the English source text when a translation is missing", () => {
    assert.equal(translate("ru", "Untranslated sentence"), "Untranslated sentence");
    assert.equal(translate("en", "Untranslated sentence"), "Untranslated sentence");
});

test("uses Russian by default and keeps the FloralAI name", () => {
    assert.equal(defaultLocale, "ru");
    assert.equal(translate(defaultLocale, "Your AI teammate"), "Ваш ИИ-помощник");
    assert.equal(translate(defaultLocale, "FloralAI"), "FloralAI");
});

test("localizes provider errors and uses a Russian fallback for unknown errors", () => {
    const fallback = "Authentication failed. Please try again.";
    assert.equal(translateError("ru", "Email not confirmed", fallback), "Подтвердите адрес электронной почты.");
    assert.equal(translateError("ru", new Error("Unexpected provider response"), fallback), translate("ru", fallback));
    assert.equal(translateError("ru", translate("ru", "Sign in to manage your catalog."), fallback), translate("ru", "Sign in to manage your catalog."));
});

test("provides Russian copy for every literal passed to the translation function", async () => {
    const missing = [];
    async function checkDirectory(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const file = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
            if (entry.isDirectory()) { await checkDirectory(file); continue; }
            if (!entry.name.endsWith(".tsx")) continue;
            const source = ts.createSourceFile(file.pathname, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true);
            function checkArgument(node) {
                if (ts.isStringLiteral(node) && /[a-z]/i.test(node.text) && translate("ru", node.text) === node.text) missing.push(node.text);
                if (ts.isConditionalExpression(node)) { checkArgument(node.whenTrue); checkArgument(node.whenFalse); }
            }
            function visit(node) {
                if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t" && node.arguments[0]) checkArgument(node.arguments[0]);
                ts.forEachChild(node, visit);
            }
            visit(source);
        }
    }
    await checkDirectory(new URL("../", import.meta.url));
    assert.deepEqual(missing, []);
});
