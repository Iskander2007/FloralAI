import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(await readFile(new URL("./fetch-with-timeout.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { fetchWithTimeout, requestTimeoutMessage } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const stalledFetch = async (_input, { signal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});

test("a stalled network request aborts and reports a retryable timeout", async () => {
    globalThis.fetch = stalledFetch;
    // AbortSignal deadlines do not keep Node alive, while an actual socket does.
    const keepAlive = setInterval(() => {}, 1000);
    try {
        await assert.rejects(fetchWithTimeout("https://example.com", {}, 5), { message: requestTimeoutMessage });
    } finally { clearInterval(keepAlive); }
});

test("caller cancellation is preserved, including signals carried by Request", async () => {
    globalThis.fetch = stalledFetch;
    for (const inRequest of [false, true]) {
        const controller = new AbortController();
        const reason = new Error("User cancelled");
        const result = inRequest
            ? fetchWithTimeout(new Request("https://example.com", { signal: controller.signal }))
            : fetchWithTimeout("https://example.com", { signal: controller.signal });
        controller.abort(reason);
        await assert.rejects(result, (error) => error === reason);
    }
});

test("successful responses retain payload, headers and method", async () => {
    globalThis.fetch = async (input, init) => {
        assert.equal(input, "https://example.com");
        assert.equal(init.method, "POST");
        assert.equal(init.headers["Content-Type"], "application/json");
        assert.equal(init.body, '{"email":"user@example.com"}');
        assert.equal(init.signal.aborted, false);
        return Response.json({ ok: true });
    };
    const response = await fetchWithTimeout("https://example.com", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: '{"email":"user@example.com"}',
    });
    assert.deepEqual(await response.json(), { ok: true });
});
