import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("./i18n.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { isLocale, localeNames, supportedLocales, translate } = await import(
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
