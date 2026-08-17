import assert from "node:assert/strict";
import test from "node:test";
import { analyzeWithOllama, getOllamaStatus } from "./ollamaService.js";

test("AI analysis uses structured evidence and validates the response", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let requestBody: any;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ response: JSON.stringify({
      summary: "Checkout failed once.",
      findings: [{
        severity: "high",
        title: "Checkout error",
        evidence: "A captured error event",
        evidenceEventIds: ["22222222-2222-4222-8222-222222222222"],
        affectedRoutes: ["/checkout"],
        recommendation: "Inspect the failed checkout path."
      }],
      confidence: 0.9,
      limitations: [],
      suggestedQueries: ["Compare releases"]
    }) }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await analyzeWithOllama({
    appId: "app-one", question: "What failed?", model: "test-model", timeRange: "24h",
    events: [{
      id: "22222222-2222-4222-8222-222222222222", appId: "app-one", sessionId: "session",
      type: "error", timestamp: new Date().toISOString(), route: "/checkout", payload: { message: "Boom" }
    }]
  });
  assert.equal(result.findings[0].evidenceEventIds[0], "22222222-2222-4222-8222-222222222222");
  assert.equal(requestBody.options.temperature, 0);
  assert.equal(requestBody.format.type, "object");
  assert.match(requestBody.prompt, /22222222-2222-4222-8222-222222222222/);
});

test("model status exposes installed Ollama models", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ models: [{ name: "llama3.1:latest" }] }), { status: 200 });
  assert.deepEqual(await getOllamaStatus(), { available: true, models: ["llama3.1:latest"] });
});
