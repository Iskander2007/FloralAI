import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const compiled = ts.transpileModule(await readFile(new URL("./ai.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { generateAIResponse, isLiveAIConfigured } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const originalFetch = globalThis.fetch;
const names = ["AI_PROVIDER", "GROQ_API_KEY", "GROQ_MODEL", "OPENAI_API_KEY", "OPENAI_MODEL", "USE_MOCK_AI"];
const originalEnv = Object.fromEntries(names.map((name) => [name, process.env[name]]));
const context = { businessName: "Цветы", businessDescription: "Доставка по Алматы", services: [], flowerConsultant: true };
beforeEach(() => {
    for (const name of names) delete process.env[name];
    process.env.USE_MOCK_AI = "false";
});
after(() => {
    globalThis.fetch = originalFetch;
    for (const name of names) {
        if (originalEnv[name] === undefined) delete process.env[name]; else process.env[name] = originalEnv[name];
    }
});

test("the free provider sends only its own credential to Groq, even if an OpenAI key exists", async () => {
    process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "groq-test-key";
    process.env.OPENAI_API_KEY = "paid-key-must-not-be-used";
    process.env.OPENAI_MODEL = "paid-model";
    let calls = 0;
    globalThis.fetch = async (endpoint, options) => {
        calls++;
        assert.equal(endpoint, "https://api.groq.com/openai/v1/chat/completions");
        assert.equal(options.headers.Authorization, "Bearer groq-test-key");
        const body = JSON.parse(options.body);
        assert.equal(body.model, "openai/gpt-oss-20b");
        assert.equal(body.reasoning_effort, "low");
        assert.ok(body.max_completion_tokens <= 2048);
        return Response.json({ choices: [{ message: { content: "Меняйте воду в вазе." } }] });
    };
    assert.equal(isLiveAIConfigured(), true);
    assert.equal(await generateAIResponse("Как ухаживать за букетом?", context), "Меняйте воду в вазе.");
    assert.equal(calls, 1);
});

test("missing Groq credentials and unsupported providers never fall through to the paid API", async () => {
    process.env.OPENAI_API_KEY = "paid-test-key";
    globalThis.fetch = async () => { assert.fail("An unconfigured provider must not make a request"); };
    for (const provider of ["groq", "unknown"]) {
        process.env.AI_PROVIDER = provider;
        assert.equal(isLiveAIConfigured(), false);
        await assert.rejects(generateAIResponse("Вопрос", context), /not configured/);
    }
});

test("Groq quota errors do not trigger retries against another provider or expose its error body", async () => {
    process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "groq-test-key";
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ error: { message: "private provider detail" } }, { status: 429 }); };
    await assert.rejects(generateAIResponse("Вопрос", context), { message: "AI provider returned 429" });
    assert.equal(calls, 1);
});

test("existing OpenAI configuration keeps its endpoint and model, while mock mode makes no requests", async () => {
    process.env.OPENAI_API_KEY = "openai-test-key";
    globalThis.fetch = async (endpoint, options) => {
        assert.equal(endpoint, "https://api.openai.com/v1/chat/completions");
        assert.equal(JSON.parse(options.body).model, "gpt-4o-mini");
        return Response.json({ choices: [{ message: { content: "Ответ" } }] });
    };
    assert.equal(await generateAIResponse("Вопрос", context), "Ответ");
    process.env.USE_MOCK_AI = "true";
    globalThis.fetch = async () => { assert.fail("Mock mode must not use an API"); };
    assert.equal(isLiveAIConfigured(), false);
    assert.ok(await generateAIResponse("Здравствуйте", context));
});
