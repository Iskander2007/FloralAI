import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import nextTesting from "next/experimental/testing/server.js";
// This installed Next build still exports the helper under its older name.
const { unstable_doesMiddlewareMatch } = nextTesting;

const compiled = ts.transpileModule(await readFile(new URL("./proxy.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/^import .*;\r?\n/gm, "");
const { config } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const matches = (url) => unstable_doesMiddlewareMatch({ config, nextConfig: {}, url });

test("public pages, callbacks and demo APIs render without the session refresh proxy", () => {
    for (const path of ["/", "/signup", "/signup?plan=starter", "/login", "/login?error=auth_callback_failed", "/flower-shop", "/api/flower-assistant", "/auth/callback?code=example", "/api/telegram/webhook", "/_next/static/app.js"]) {
        assert.equal(matches(path), false, path);
    }
});

test("all account pages and protected APIs still refresh session cookies", () => {
    for (const path of ["/dashboard", "/dashboard/settings", "/onboarding", "/api/business-profile", "/api/chat", "/api/orders", "/api/billing", "/api/billing/trial", "/api/billing/payments/123", "/api/telegram/setup"]) {
        assert.equal(matches(path), true, path);
    }
});
