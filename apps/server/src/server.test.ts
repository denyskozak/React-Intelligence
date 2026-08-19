import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "react-intelligence-test-"));
process.env.REACT_INTELLIGENCE_DB = join(temporaryDirectory, "test.sqlite");
const { buildApp } = await import("./index.js");

test("ingestion and reads enforce project-scoped credentials", async (context) => {
  const originalFetch = globalThis.fetch;
  const deliveredWebhooks: Array<{ url: string; headers: Headers; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    deliveredWebhooks.push({ url: String(input), headers: new Headers(init?.headers), body: String(init?.body) });
    return new Response(null, { status: 204 });
  };
  const app = await buildApp({
    deploymentMode: "self-hosted",
    authDisabled: false,
    dashboardToken: "dashboard-token",
    readTokens: { "app-one-reader": ["app-one"] },
    projects: {
      "app-one": { writeKey: "app-one-write" },
      "app-two": { writeKey: "app-two-write" }
    },
    allowedOrigins: ["http://localhost:5178"],
    webhookAllowedHosts: ["hooks.example.test"],
    webhookSigningSecret: "test-webhook-secret",
    port: 0,
    host: "127.0.0.1"
  });
  context.after(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  const event = {
    id: crypto.randomUUID(),
    appId: "app-one",
    sessionId: "session-one",
    type: "custom",
    timestamp: new Date().toISOString(),
    payload: { name: "connected", email: "private@example.com" }
  };

  const identity = await app.inject({ method: "GET", url: "/api/auth/me", headers: { authorization: "Bearer dashboard-token" } });
  assert.equal(identity.statusCode, 200);
  assert.equal(identity.json().role, "owner");
  assert.equal(identity.json().appIds, "all");
  assert.ok(identity.headers["x-request-id"]);
  const anonymousIdentity = await app.inject({ method: "GET", url: "/api/auth/me" });
  assert.equal(anonymousIdentity.statusCode, 401);

  const missingKey = await app.inject({ method: "POST", url: "/api/events/batch", payload: { events: [event] } });
  assert.equal(missingKey.statusCode, 401);

  const wrongProject = await app.inject({
    method: "POST", url: "/api/events/batch",
    headers: { authorization: "Bearer app-two-write" }, payload: { events: [event] }
  });
  assert.equal(wrongProject.statusCode, 403);

  const accepted = await app.inject({
    method: "POST", url: "/api/events/batch",
    headers: { authorization: "Bearer app-one-write" }, payload: { events: [event] }
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.json().accepted, 1);

  const retried = await app.inject({
    method: "POST", url: "/api/events/batch",
    headers: { authorization: "Bearer app-one-write" }, payload: { events: [event] }
  });
  assert.equal(retried.statusCode, 200);
  assert.equal(retried.json().accepted, 0);
  assert.equal(retried.json().duplicates, 1);

  const scopedRead = await app.inject({
    method: "GET", url: "/api/apps/app-one/events?timeRange=all",
    headers: { authorization: "Bearer app-one-reader" }
  });
  assert.equal(scopedRead.statusCode, 200);
  assert.equal(scopedRead.json().events[0].payload.email, "[REDACTED]");

  const appOverview = await app.inject({
    method: "GET", url: "/api/apps/app-one/overview?timeRange=all",
    headers: { authorization: "Bearer app-one-reader" }
  });
  assert.equal(appOverview.statusCode, 200);
  assert.equal(appOverview.json().windowEvents, 1);
  assert.equal(appOverview.json().timeRange, "all");

  const sharedTimestamp = new Date(Date.now() + 10).toISOString();
  const sameTimestampEvents = [
    { ...event, id: "00000000-0000-4000-8000-000000000001", timestamp: sharedTimestamp },
    { ...event, id: "00000000-0000-4000-8000-000000000002", timestamp: sharedTimestamp }
  ];
  const sameTimestampIngestion = await app.inject({
    method: "POST", url: "/api/events/batch",
    headers: { authorization: "Bearer app-one-write" }, payload: { events: sameTimestampEvents }
  });
  assert.equal(sameTimestampIngestion.statusCode, 200);
  assert.equal(sameTimestampIngestion.json().accepted, 2);
  const sameTimestampRead = await app.inject({
    method: "GET", url: "/api/apps/app-one/events?timeRange=all&limit=10",
    headers: { authorization: "Bearer app-one-reader" }
  });
  assert.deepEqual(
    sameTimestampRead.json().events.filter((candidate: { timestamp: string }) => candidate.timestamp === sharedTimestamp).map((candidate: { id: string }) => candidate.id),
    [sameTimestampEvents[1].id, sameTimestampEvents[0].id]
  );
  const firstPage = await app.inject({
    method: "GET", url: "/api/apps/app-one/events?timeRange=all&limit=1",
    headers: { authorization: "Bearer app-one-reader" }
  });
  const cursor = firstPage.json().nextCursor as { timestamp: string; id: string };
  assert.equal(cursor.timestamp, sharedTimestamp);
  assert.equal(cursor.id, sameTimestampEvents[1].id);
  const secondPage = await app.inject({
    method: "GET",
    url: `/api/apps/app-one/events?timeRange=all&limit=1&cursor=${encodeURIComponent(cursor.timestamp)}&cursorId=${cursor.id}`,
    headers: { authorization: "Bearer app-one-reader" }
  });
  assert.equal(secondPage.json().events[0].id, sameTimestampEvents[0].id);
  assert.equal(secondPage.json().events[0].timestamp, sharedTimestamp);

  const createdProject = await app.inject({
    method: "POST", url: "/api/projects",
    headers: { authorization: "Bearer dashboard-token" },
    payload: { appId: "fresh-app", name: "Fresh App" }
  });
  assert.equal(createdProject.statusCode, 201);
  assert.match(createdProject.json().writeKey, /^ri_write_/);
  const freshIngestion = await app.inject({
    method: "POST", url: "/api/events/batch",
    headers: { authorization: `Bearer ${createdProject.json().writeKey}` },
    payload: { events: [{ ...event, id: crypto.randomUUID(), appId: "fresh-app", sessionId: "fresh-session" }] }
  });
  assert.equal(freshIngestion.statusCode, 200);
  const projects = await app.inject({ method: "GET", url: "/api/projects", headers: { authorization: "Bearer dashboard-token" } });
  assert.equal(projects.json().projects.find((project: { appId: string }) => project.appId === "fresh-app").connected, true);

  const retention = await app.inject({
    method: "PATCH", url: "/api/projects/app-one/retention",
    headers: { authorization: "Bearer dashboard-token" }, payload: { retentionDays: 90 }
  });
  assert.equal(retention.statusCode, 200);
  assert.equal(retention.json().retentionDays, 90);

  const exportResponse = await app.inject({
    method: "GET", url: "/api/projects/app-one/export?format=csv",
    headers: { authorization: "Bearer app-one-reader" }
  });
  assert.equal(exportResponse.statusCode, 200);
  assert.match(exportResponse.body, /v2|connected/);

  const alertRule = await app.inject({
    method: "POST", url: "/api/apps/app-one/alerts",
    headers: { authorization: "Bearer dashboard-token" },
    payload: { name: "Any errors", metric: "error_rate", threshold: 0, timeRange: "1h", enabled: true }
  });
  assert.equal(alertRule.statusCode, 201);

  const webhookRule = await app.inject({
    method: "POST", url: "/api/apps/app-one/alerts",
    headers: { authorization: "Bearer dashboard-token" },
    payload: { name: "Webhook errors", metric: "error_rate", threshold: 0, timeRange: "1h", enabled: true, webhookUrl: "https://hooks.example.test/react-intelligence" }
  });
  assert.equal(webhookRule.statusCode, 201);

  const viewerToken = await app.inject({
    method: "POST", url: "/api/access-tokens",
    headers: { authorization: "Bearer dashboard-token" },
    payload: { name: "App One Viewer", role: "viewer", appIds: ["app-one"] }
  });
  assert.equal(viewerToken.statusCode, 201);
  const viewerValue = viewerToken.json().value as string;
  const viewerRead = await app.inject({ method: "GET", url: "/api/apps/app-one/events", headers: { authorization: `Bearer ${viewerValue}` } });
  assert.equal(viewerRead.statusCode, 200);
  const viewerMutation = await app.inject({
    method: "POST", url: "/api/apps/app-one/alerts", headers: { authorization: `Bearer ${viewerValue}` },
    payload: { name: "Forbidden", metric: "error_rate", threshold: 1, timeRange: "1h", enabled: true }
  });
  assert.equal(viewerMutation.statusCode, 403);
  const viewerRevocation = await app.inject({ method: "DELETE", url: `/api/access-tokens/${viewerToken.json().token.id}`, headers: { authorization: "Bearer dashboard-token" } });
  assert.equal(viewerRevocation.statusCode, 204);
  const revokedViewerRead = await app.inject({ method: "GET", url: "/api/apps/app-one/events", headers: { authorization: `Bearer ${viewerValue}` } });
  assert.equal(revokedViewerRead.statusCode, 401);

  const memberToken = await app.inject({
    method: "POST", url: "/api/access-tokens", headers: { authorization: "Bearer dashboard-token" },
    payload: { name: "App One Member", role: "member", appIds: ["app-one"] }
  });
  const memberValue = memberToken.json().value as string;
  const memberMutation = await app.inject({
    method: "POST", url: "/api/apps/app-one/alerts", headers: { authorization: `Bearer ${memberValue}` },
    payload: { name: "Member rule", metric: "network_failures", threshold: 99, timeRange: "1h", enabled: true }
  });
  assert.equal(memberMutation.statusCode, 201);
  const memberOwnerAction = await app.inject({ method: "GET", url: "/api/access-tokens", headers: { authorization: `Bearer ${memberValue}` } });
  assert.equal(memberOwnerAction.statusCode, 403);

  const forbiddenRead = await app.inject({
    method: "GET", url: "/api/apps/app-two/events",
    headers: { authorization: "Bearer app-one-reader" }
  });
  assert.equal(forbiddenRead.statusCode, 403);

  const sourceMapUpload = await app.inject({
    method: "POST", url: "/api/apps/app-one/source-maps",
    headers: { authorization: "Bearer app-one-write" },
    payload: {
      release: "1.0.0",
      bundleName: "app.js",
      map: JSON.stringify({ version: 3, file: "app.js", sources: ["src/App.tsx"], names: [], mappings: "AAAA" })
    }
  });
  assert.equal(sourceMapUpload.statusCode, 201);

  const errorEvent = {
    ...event,
    id: crypto.randomUUID(),
    type: "error",
    release: "1.0.0",
    payload: { message: "Boom", stack: "Error: Boom\n    at render (https://cdn.example.com/app.js:1:1)" }
  };
  const errorIngestion = await app.inject({
    method: "POST", url: "/api/events/batch",
    headers: { authorization: "Bearer app-one-write" }, payload: { events: [errorEvent] }
  });
  assert.equal(errorIngestion.statusCode, 200);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(deliveredWebhooks.length, 1);
  assert.equal(deliveredWebhooks[0].url, "https://hooks.example.test/react-intelligence");
  assert.match(deliveredWebhooks[0].headers.get("x-react-intelligence-signature") ?? "", /^sha256=/);

  const issues = await app.inject({ method: "GET", url: "/api/apps/app-one/issues?status=open", headers: { authorization: "Bearer app-one-reader" } });
  assert.equal(issues.statusCode, 200);
  assert.equal(issues.json().issues.length, 1);
  assert.equal(issues.json().issues[0].title, "Boom");
  const issueId = issues.json().issues[0].id as string;
  const resolvedIssue = await app.inject({
    method: "PATCH", url: `/api/apps/app-one/issues/${issueId}`, headers: { authorization: `Bearer ${memberValue}` }, payload: { status: "resolved" }
  });
  assert.equal(resolvedIssue.statusCode, 200);
  assert.equal(resolvedIssue.json().issue.status, "resolved");
  const regressionIngestion = await app.inject({
    method: "POST", url: "/api/events/batch", headers: { authorization: "Bearer app-one-write" },
    payload: { events: [{ ...errorEvent, id: crypto.randomUUID(), timestamp: new Date(Date.now() + 1).toISOString() }] }
  });
  assert.equal(regressionIngestion.statusCode, 200);
  const reopenedIssues = await app.inject({ method: "GET", url: "/api/apps/app-one/issues?status=open", headers: { authorization: "Bearer app-one-reader" } });
  assert.equal(reopenedIssues.json().issues[0].status, "open");
  assert.equal(reopenedIssues.json().issues[0].eventCount, 2);

  const baseEvent = {
    ...event,
    id: crypto.randomUUID(),
    type: "network",
    release: "0.9.0",
    payload: { url: "https://api.example.test/catalog", duration: 120, status: 200, success: true }
  };
  await app.inject({ method: "POST", url: "/api/events/batch", headers: { authorization: "Bearer app-one-write" }, payload: { events: [baseEvent] } });
  const comparison = await app.inject({
    method: "GET", url: "/api/apps/app-one/releases/compare?base=0.9.0&target=1.0.0&timeRange=all",
    headers: { authorization: "Bearer app-one-reader" }
  });
  assert.equal(comparison.statusCode, 200);
  assert.equal(comparison.json().base.release, "0.9.0");
  assert.equal(comparison.json().target.errors, 2);

  const alerts = await app.inject({ method: "GET", url: "/api/apps/app-one/alerts", headers: { authorization: "Bearer app-one-reader" } });
  assert.equal(alerts.statusCode, 200);
  assert.equal(alerts.json().incidents[0].status, "open");
  assert.equal(alerts.json().deliveries[0].status, "delivered");
  const errors = await app.inject({
    method: "GET", url: "/api/apps/app-one/events?type=error&timeRange=all",
    headers: { authorization: "Bearer app-one-reader" }
  });
  assert.match(errors.json().events[0].payload.symbolicatedStack, /src\/App\.tsx:1:1/);

  const rotation = await app.inject({
    method: "POST", url: "/api/projects/app-one/keys", headers: { authorization: `Bearer ${memberValue}` },
    payload: { name: "Rotated key", revokeExisting: true }
  });
  assert.equal(rotation.statusCode, 201);
  const rotatedWriteKey = rotation.json().writeKey as string;
  const revokedKeyWrite = await app.inject({ method: "POST", url: "/api/events/batch", headers: { authorization: "Bearer app-one-write" }, payload: { events: [{ ...event, id: crypto.randomUUID() }] } });
  assert.equal(revokedKeyWrite.statusCode, 401);
  const rotatedKeyWrite = await app.inject({ method: "POST", url: "/api/events/batch", headers: { authorization: `Bearer ${rotatedWriteKey}` }, payload: { events: [{ ...event, id: crypto.randomUUID() }] } });
  assert.equal(rotatedKeyWrite.statusCode, 200);

  const quota = await app.inject({ method: "PATCH", url: "/api/projects/app-one/quota", headers: { authorization: "Bearer dashboard-token" }, payload: { monthlyEventQuota: 100 } });
  assert.equal(quota.statusCode, 200);
  const oversizedForQuota = Array.from({ length: 100 }, () => ({ ...event, id: crypto.randomUUID() }));
  const quotaRejected = await app.inject({ method: "POST", url: "/api/events/batch", headers: { authorization: `Bearer ${rotatedWriteKey}` }, payload: { events: oversizedForQuota } });
  assert.equal(quotaRejected.statusCode, 429);
  assert.equal(quotaRejected.headers["retry-after"], "3600");
  const diagnostics = await app.inject({ method: "GET", url: "/api/projects/app-one/ingestion", headers: { authorization: "Bearer app-one-reader" } });
  assert.equal(diagnostics.statusCode, 200);
  assert.equal(diagnostics.json().rejectedEvents, 100);
  assert.equal(diagnostics.json().duplicateEvents, 1);

  const ready = await app.inject({ method: "GET", url: "/ready" });
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.json().schemaVersion, 5);
  const integrity = await app.inject({ method: "GET", url: "/api/operations/integrity", headers: { authorization: "Bearer dashboard-token" } });
  assert.equal(integrity.statusCode, 200);
  assert.equal(integrity.json().result, "ok");
  const anonymousIntegrity = await app.inject({ method: "GET", url: "/api/operations/integrity" });
  assert.equal(anonymousIntegrity.statusCode, 401);
  const metrics = await app.inject({ method: "GET", url: "/metrics", headers: { authorization: "Bearer dashboard-token", accept: "application/json" } });
  assert.equal(metrics.statusCode, 200);
  assert.ok(metrics.json().requestsTotal > 0);
  assert.ok(metrics.json().duplicateEvents >= 1);
  const prometheus = await app.inject({ method: "GET", url: "/metrics", headers: { authorization: "Bearer dashboard-token" } });
  assert.match(prometheus.body, /react_intelligence_ingestion_events_total\{result="accepted"\}/);

  const audit = await app.inject({ method: "GET", url: "/api/audit-log", headers: { authorization: "Bearer app-one-reader" } });
  assert.equal(audit.statusCode, 200);
  assert.ok(audit.json().entries.some((entry: { action: string }) => entry.action === "project.write_key_created"));
  assert.ok(audit.json().entries.every((entry: { appId?: string }) => entry.appId === "app-one"));

  const rejectedDelete = await app.inject({ method: "DELETE", url: "/api/projects/app-one/data", headers: { authorization: "Bearer dashboard-token" } });
  assert.equal(rejectedDelete.statusCode, 400);
  const deleted = await app.inject({ method: "DELETE", url: "/api/projects/app-one/data", headers: { authorization: "Bearer dashboard-token", "x-confirm-app-id": "app-one" } });
  assert.equal(deleted.statusCode, 200);
  assert.ok(deleted.json().deleted.events >= 1);
});
