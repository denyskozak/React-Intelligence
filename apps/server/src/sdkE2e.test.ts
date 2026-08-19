import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Window } from "happy-dom";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "react-intelligence-sdk-e2e-"));
process.env.REACT_INTELLIGENCE_DB = join(temporaryDirectory, "sdk-e2e.sqlite");
const { buildApp } = await import("./index.js");

test("a React SDK queue survives offline delivery and reaches SQLite exactly once", async (context) => {
  const app = await buildApp({
    deploymentMode: "self-hosted",
    authDisabled: false,
    dashboardToken: "sdk-e2e-dashboard",
    readTokens: {},
    projects: { "sdk-e2e": { writeKey: "sdk-e2e-write", name: "SDK E2E" } },
    allowedOrigins: ["http://sdk-e2e.local"],
    webhookAllowedHosts: [],
    webhookSigningSecret: "sdk-e2e-webhook-secret",
    port: 0,
    host: "127.0.0.1"
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}`;

  const browserWindow = new Window({ url: `${endpoint}/checkout` });
  installBrowserGlobals(browserWindow);
  const sdk = await import("@react-intelligence/sdk");
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const rootElement = browserWindow.document.createElement("div");
  browserWindow.document.body.append(rootElement);

  context.after(async () => {
    sdk.cleanupReactIntelligence(false);
    await app.close();
    await browserWindow.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  const common = {
    appId: "sdk-e2e",
    writeKey: "sdk-e2e-write",
    environment: "test",
    release: "sdk-e2e-1",
    captureNetwork: false,
    capturePerformance: false,
    captureUserActions: false,
    flushIntervalMs: 60_000
  };

  sdk.configureReactIntelligence({ ...common, endpoint: "http://127.0.0.1:1" });
  sdk.track("offline_recovered", { source: "offline-queue" });
  await sdk.flushReactIntelligence();
  const storageKey = "react-intelligence-pending:sdk-e2e";
  assert.match(browserWindow.localStorage.getItem(storageKey) ?? "", /offline_recovered/);

  sdk.configureReactIntelligence({ ...common, endpoint });
  function Producer() {
    React.useEffect(() => { sdk.track("react_provider_smoke", { rendered: true }); }, []);
    return React.createElement("button", { "data-testid": "sdk-smoke" }, "SDK smoke");
  }
  const root = createRoot(rootElement as unknown as Element);
  root.render(React.createElement(sdk.ReactIntelligenceProvider, { ...common, endpoint }, React.createElement(Producer)));
  await waitFor(() => Boolean(browserWindow.document.querySelector('[data-testid="sdk-smoke"]')));
  sdk.track("oversized_event", { huge: Array.from({ length: 50 }, () => "x".repeat(2_000)) });
  await sdk.flushReactIntelligence();
  await waitFor(() => browserWindow.localStorage.getItem(storageKey) === null);

  const response = await fetch(`${endpoint}/api/apps/sdk-e2e/events?timeRange=all`, {
    headers: { authorization: "Bearer sdk-e2e-dashboard" }
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { events: Array<{ id: string; type: string; payload: Record<string, unknown> }> };
  const names = body.events.filter((event) => event.type === "custom").map((event) => event.payload.name);
  assert.ok(names.includes("offline_recovered"));
  assert.ok(names.includes("react_provider_smoke"));
  const oversized = body.events.find((event) => event.payload.name === "oversized_event");
  assert.equal(oversized?.payload.telemetryTruncated, true);
  assert.equal(new Set(body.events.map((event) => event.id)).size, body.events.length);
  root.unmount();
});

function installBrowserGlobals(browserWindow: Window) {
  const values: Record<string, unknown> = {
    window: browserWindow,
    document: browserWindow.document,
    navigator: browserWindow.navigator,
    localStorage: browserWindow.localStorage,
    sessionStorage: browserWindow.sessionStorage,
    history: browserWindow.history,
    location: browserWindow.location,
    HTMLElement: browserWindow.HTMLElement,
    Event: browserWindow.Event,
    ErrorEvent: browserWindow.ErrorEvent,
    CustomEvent: browserWindow.CustomEvent,
    MouseEvent: browserWindow.MouseEvent,
    PerformanceObserver: browserWindow.PerformanceObserver
  };
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for SDK smoke condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
