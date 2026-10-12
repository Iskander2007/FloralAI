import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("./business.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { parseBusinessProfile } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const profile = {
    name: "  Цветы рядом  ", category: "Retail & online shop", description: "Свежие букеты",
    location: "Алматы", hours: "09:00–20:00", phone: "+77771234567",
    language: "Russian", tone: "Friendly", services: [" Открытка ", ""], acceptOrdersOffline: true,
};

test("normalizes approved business fields without accepting tenant or payment data", () => {
    const parsed = parseBusinessProfile({ ...profile, owner_id: "another-owner", paymentPhone: "+77770000000", active: true });
    assert.equal(parsed.name, "Цветы рядом");
    assert.deepEqual(parsed.services, ["Открытка"]);
    assert.equal(parsed.acceptOrdersOffline, true);
    assert.equal(Object.hasOwn(parsed, "owner_id"), false);
    assert.equal(Object.hasOwn(parsed, "paymentPhone"), false);
    assert.equal(Object.hasOwn(parsed, "active"), false);
});

test("distinguishes unknown delivery from free delivery and rejects invalid amounts", () => {
    assert.equal(parseBusinessProfile(profile).deliveryFeeKzt, null);
    assert.equal(parseBusinessProfile({ ...profile, deliveryFeeKzt: 0 }).deliveryFeeKzt, 0);
    for (const fee of [-1, 1.5, "1000", Number.MAX_SAFE_INTEGER, NaN]) {
        assert.equal(parseBusinessProfile({ ...profile, deliveryFeeKzt: fee }), null);
    }
});

test("rejects invalid fields and excessive business knowledge", () => {
    for (const invalid of [null, [], { ...profile, name: " " }, { ...profile, category: "unknown" },
        { ...profile, language: "French" }, { ...profile, language: ["Russian"] },
        { ...profile, tone: ["Friendly"] }, { ...profile, description: "x".repeat(8001) },
        { ...profile, services: Array(31).fill("услуга") }, { ...profile, services: [42] },
        { ...profile, deliveryAreas: "x".repeat(1001) }, { ...profile, acceptOrdersOffline: "true" }]) {
        assert.equal(parseBusinessProfile(invalid), null);
    }
});
