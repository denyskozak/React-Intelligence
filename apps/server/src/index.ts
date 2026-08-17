import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import {
  analyzeRequestSchema,
  alertRuleSchema,
  batchEventsRequestSchema,
  createAccessTokenSchema,
  createProjectSchema,
  eventFiltersSchema,
  issueStatusSchema,
  quotaSchema,
  releaseComparisonSchema,
  retentionSchema,
  rotateProjectKeySchema,
  sourceMapUploadSchema,
  type IntelligenceEvent
} from "@react-intelligence/shared";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canManageApp, canReadApp, hashWriteKey, ingestionAppId, readScope } from "./auth.js";
import { loadConfig, type ServerConfig } from "./config.js";
import { db } from "./db/client.js";
import {
  compareReleases,
  backfillErrorIssues,
  createAccessToken,
  createAlertRule,
  createProjectKey,
  deleteAlertRule,
  deleteProjectData,
  ensureProject,
  evaluateAlerts,
  exportEvents,
  filterUnseenEvents,
  getIngestionDiagnostics,
  listAlertIncidents,
  listAlertRules,
  listAnalyses,
  listAccessTokens,
  listAuditEntries,
  listProjects,
  listProjectKeys,
  listWebhookDeliveries,
  getAppOverview,
  getRecentEvents,
  groupedErrors,
  listEvents,
  listErrorIssues,
  overview,
  recordAudit,
  recordIngestion,
  recordAnalysis,
  runRetention,
  saveEvents,
  saveSourceMap,
  setRetention,
  setMonthlyEventQuota,
  updateErrorIssueStatus,
  revokeAccessToken,
  revokeProjectKey
} from "./db/eventsRepository.js";
import { analyzeWithOllama, getOllamaStatus } from "./services/ollamaService.js";
import { scrubPayload } from "./services/privacyService.js";
import { symbolicateEvents } from "./services/sourceMapService.js";
import { deliverPendingWebhooks, queueAlertWebhooks, validateWebhookUrl } from "./services/webhookService.js";
import { collectOperationalMetrics, prometheusMetrics, recordIngestionMetrics, recordRequest, resetOperationalMetrics } from "./services/metricsService.js";

export async function buildApp(config: ServerConfig = loadConfig()): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, bodyLimit: 1_500_000 });
  resetOperationalMetrics();
  for (const [appId, project] of Object.entries(config.projects)) {
    ensureProject(appId, project.name ?? appId, hashWriteKey(project.writeKey), project.writeKey.slice(0, 16));
  }
  backfillErrorIssues();
  runRetention();
  void deliverPendingWebhooks(config);
  const retentionTimer = setInterval(() => runRetention(), 6 * 60 * 60 * 1000);
  const webhookTimer = setInterval(() => void deliverPendingWebhooks(config), 60_000);
  retentionTimer.unref();
  webhookTimer.unref();
  app.addHook("onClose", async () => { clearInterval(retentionTimer); clearInterval(webhookTimer); });
  await app.register(cors, { origin: config.allowedOrigins });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (request) => rateLimitKey(request)
  });
  app.addHook("onResponse", async (_request, reply) => { recordRequest(reply.statusCode); });

  app.get("/health", async () => ({ ok: true, deploymentMode: config.deploymentMode }));
  app.get("/api/auth/me", async (request, reply) => {
    const scope = requireReadScope(request, reply, config);
    if (!scope) return;
    return { actor: scope.actor, role: scope.role, appIds: scope.all ? "all" : [...scope.appIds] };
  });
  app.get("/ready", async (_request, reply) => {
    try {
      const integrity = db.prepare("PRAGMA quick_check").get() as { quick_check: string };
      const migration = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number };
      if (integrity.quick_check !== "ok") throw new Error(integrity.quick_check);
      return { ready: true, database: "ok", schemaVersion: Number(migration.version) };
    } catch (error) {
      return reply.status(503).send({ ready: false, error: error instanceof Error ? error.message : "Database unavailable" });
    }
  });

  app.get("/metrics", async (request, reply) => {
    if (!requireOwner(request, reply, config)) return;
    if ((request.headers.accept ?? "").includes("application/json")) return collectOperationalMetrics();
    return reply.type("text/plain; version=0.0.4").send(prometheusMetrics());
  });

  app.post("/api/events/batch", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = batchEventsRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, "Invalid event batch", parsed.error.flatten());
    const authorizedAppId = ingestionAppId(request, config);
    if (!authorizedAppId) return reply.status(401).send({ error: "Invalid or missing write key" });
    if (authorizedAppId !== "*" && parsed.data.events.some((event) => event.appId !== authorizedAppId)) {
      return reply.status(403).send({ error: "Write key does not belong to this project" });
    }
    const serializedBytes = Buffer.byteLength(JSON.stringify(request.body));
    const unseenByApp = new Map<string, IntelligenceEvent[]>();
    for (const [appId, appEvents] of groupEventsByApp(parsed.data.events)) {
      const unseenEvents = filterUnseenEvents(appEvents);
      unseenByApp.set(appId, unseenEvents);
      const diagnostics = getIngestionDiagnostics(appId);
      if (diagnostics && diagnostics.remainingEvents < unseenEvents.length) {
        const duplicates = appEvents.length - unseenEvents.length;
        recordIngestion(appId, 0, unseenEvents.length, serializedBytes, duplicates);
        recordIngestionMetrics({ accepted: 0, duplicates, rejected: unseenEvents.length });
        return reply.header("retry-after", "3600").status(429).send({ error: "Monthly event quota exceeded", diagnostics });
      }
    }
    let accepted = 0;
    let duplicates = 0;
    for (const [appId, appEvents] of groupEventsByApp(parsed.data.events)) {
      const events = (unseenByApp.get(appId) ?? []).map((event) => ({
        ...event,
        payload: scrubPayload(event.payload) as Record<string, unknown>
      }));
      const result = saveEvents(events);
      const appDuplicates = appEvents.length - result.accepted;
      accepted += result.accepted;
      duplicates += appDuplicates;
      recordIngestion(appId, result.accepted, 0, serializedBytes, appDuplicates);
      if (result.accepted) queueAlertWebhooks(evaluateAlerts(appId), config);
    }
    recordIngestionMetrics({ accepted, duplicates, rejected: 0 });
    return { accepted, duplicates };
  });

  app.get("/api/projects", async (request, reply) => {
    const scope = requireReadScope(request, reply, config);
    if (!scope) return;
    const projects = listProjects().filter((project) => scope.all || scope.appIds.has(project.appId));
    return { projects };
  });

  app.post("/api/projects", async (request, reply) => {
    if (!requireOwner(request, reply, config)) return;
    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, "Invalid project", parsed.error.flatten());
    if (listProjects().some((project) => project.appId === parsed.data.appId)) {
      return reply.status(409).send({ error: "Project already exists" });
    }
    const writeKey = `ri_write_${randomBytes(24).toString("hex")}`;
    ensureProject(parsed.data.appId, parsed.data.name);
    createProjectKey(parsed.data.appId, "Primary", writeKey.slice(0, 16), hashWriteKey(writeKey), false);
    audit(request, config, "project.created", parsed.data.appId, { name: parsed.data.name });
    return reply.status(201).send({ project: listProjects().find((project) => project.appId === parsed.data.appId), writeKey });
  });

  app.get("/api/projects/:appId/connection", async (request, reply) => {
    const appId = appIdFrom(request);
    if (!authorizeAppRead(request, reply, config, appId)) return;
    const project = listProjects().find((candidate) => candidate.appId === appId);
    return project ?? reply.status(404).send({ error: "Project not found" });
  });

  app.patch("/api/projects/:appId/retention", async (request, reply) => {
    const appId = appIdFrom(request);
    if (!authorizeAppManage(request, reply, config, appId)) return;
    const parsed = retentionSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, "Invalid retention", parsed.error.flatten());
    if (!setRetention(appId, parsed.data.retentionDays)) return reply.status(404).send({ error: "Project not found" });
    const deleted = runRetention(appId);
    audit(request, config, "project.retention_updated", appId, { retentionDays: parsed.data.retentionDays, deleted });
    return { retentionDays: parsed.data.retentionDays, deleted };
  });

  app.patch("/api/projects/:appId/quota", async (request, reply) => {
    if (!requireOwner(request, reply, config)) return;
    const appId = appIdFrom(request);
    const parsed = quotaSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, "Invalid quota", parsed.error.flatten());
    if (!setMonthlyEventQuota(appId, parsed.data.monthlyEventQuota)) return reply.status(404).send({ error: "Project not found" });
    audit(request, config, "project.quota_updated", appId, parsed.data);
    return getIngestionDiagnostics(appId);
  });

  app.get("/api/projects/:appId/ingestion", async (request, reply) => {
    const appId = appIdFrom(request);
    if (!authorizeAppRead(request, reply, config, appId)) return;
    return getIngestionDiagnostics(appId) ?? reply.status(404).send({ error: "Project not found" });
  });

  app.get("/api/projects/:appId/keys", async (request, reply) => {
    const appId = appIdFrom(request);
    if (!authorizeAppManage(request, reply, config, appId)) return;
    return { keys: listProjectKeys(appId) };
  });

  app.post("/api/projects/:appId/keys", async (request, reply) => {
    const appId = appIdFrom(request);
    if (!authorizeAppManage(request, reply, config, appId)) return;
    const parsed = rotateProjectKeySchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, "Invalid key rotation", parsed.error.flatten());
    const writeKey = `ri_write_${randomBytes(24).toString("hex")}`;
    const key = createProjectKey(appId, parsed.data.name, writeKey.slice(0, 16), hashWriteKey(writeKey), parsed.data.revokeExisting);
    audit(request, config, "project.write_key_created", appId, { keyId: key.id, revokeExisting: parsed.data.revokeExisting });
    return reply.status(201).send({ key, writeKey });
  });

  app.delete("/api/projects/:appId/keys/:keyId", async (request, reply) => {
    const appId = appIdFrom(request);
    if (!authorizeAppManage(request, reply, config, appId)) return;
    const { keyId } = request.params as { keyId: string };
    if (!revokeProjectKey(appId, keyId)) return reply.status(404).send({ error: "Active key not found" });
    audit(request, config, "project.write_key_revoked", appId, { keyId });
    return reply.status(204).send();
  });

  app.get("/api/projects/:appId/export", async (request, reply) => {
    const appId = appIdFrom(request);
    if (!authorizeAppRead(request, reply, config, appId)) return;
    const format = (request.query as { format?: string }).format ?? "json";
    if (format !== "json" && format !== "csv") return reply.status(400).send({ error: "format must be json or csv" });
    const events = exportEvents(appId);
    reply.header("content-disposition", `attachment; filename="${appId}-events.${format}"`);
    if (format === "csv") return reply.type("text/csv").send(toCsv(events));
    return { appId, exportedAt: new Date().toISOString(), events };
  });

  app.delete("/api/projects/:appId/data", async (request, reply) => {
    if (!requireOwner(request, reply, config)) return;
    const appId = appIdFrom(request);
    if (request.headers["x-confirm-app-id"] !== appId) return reply.status(400).send({ error: "x-confirm-app-id header must match the project" });
    const deleted = deleteProjectData(appId);
    audit(request, config, "project.data_deleted", appId, deleted);
    return { deleted };
  });

  app.get("/api/apps", async (request, reply) => {
    const scope = requireReadScope(request, reply, config);
    if (!scope) return;
    return overview(scope.all ? undefined : scope.appIds);
  });

  app.get("/api/apps/:appId/overview", async (request, reply) => {
    const appId = appIdFrom(request);
    if (!authorizeAppRead(request, reply, config, appId)) return;
    const parsed = eventFiltersSchema.pick({ timeRange: true }).safeParse(request.query);
    if (!parsed.success) return badRequest(reply, "Invalid time range", parsed.error.flatten());
    return getAppOverview(appId, parsed.data.timeRange);
  });

  app.get("/api/apps/:appId/events", async (request, reply) => {
    const appId = appIdFrom(request);
    if (!authorizeAppRead(request, reply, config, appId)) return;
    const parsed = eventFiltersSchema.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, "Invalid event filters", parsed.error.flatten());
    const events = symbolicateEvents(appId, listEvents(appId, parsed.data));
    return { events, nextCursor: events.length === parsed.data.limit ? events.at(-1)?.timestamp : undefined };
  });

  app.get("/api/apps/:appId/errors", async (request, reply) => {
    const appId = appIdFrom(request);
    if (!authorizeAppRead(request, reply, config, appId)) return;
    const parsed = eventFiltersSchema.pick({ timeRange: true }).safeParse(request.query);
    if (!parsed.success) return badRequest(reply, "Invalid time range", parsed.error.flatten());
    const errorEvents = listEvents(appId, { type: "error", timeRange: parsed.data.timeRange, limit: 200 });
    const reactEvents = listEvents(appId, { type: "react_error", timeRange: parsed.data.timeRange, limit: 200 });
    return {
      groups: groupedErrors(appId, parsed.data.timeRange),
      issues: listErrorIssues(appId, "all"),
      events: symbolicateEvents(appId, errorEvents.concat(reactEvents).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 200))
    };
  });

  app.get("/api/apps/:appId/issues", async (request, reply) => {
    const appId = appIdFrom(request);
    if (!authorizeAppRead(request, reply, config, appId)) return;
    const status = (request.query as { status?: string }).status ?? "open";
    if (!(["open", "resolved", "ignored", "all"] as const).includes(status as any)) {
      return reply.status(400).send({ error: "status must be open, resolved, ignored, or all" });
    }
    return { issues: listErrorIssues(appId, status as "open" | "resolved" | "ignored" | "all") };
  });

  app.patch("/api/apps/:appId/issues/:issueId", async (request, reply) => {
    const appId = appIdFrom(request);
    if (!authorizeAppManage(request, reply, config, appId)) return;
    const parsed = issueStatusSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, "Invalid issue status", parsed.error.flatten());
    const { issueId } = request.params as { issueId: string };
    const scope = readScope(request, config)!;
    if (!updateErrorIssueStatus(appId, issueId, parsed.data.status, scope.actor)) return reply.status(404).send({ error: "Issue not found" });
    audit(request, config, "error_issue.status_updated", appId, { issueId, status: parsed.data.status });
    return { issue: listErrorIssues(appId, "all").find((issue) => issue.id === issueId) };
  });

  app.get("/api/apps/:appId/performance", async (request, reply) => {
    const appId = appIdFrom(request);
    if (!authorizeAppRead(request, reply, config, appId)) return;
    const parsed = eventFiltersSchema.pick({ timeRange: true }).safeParse(request.query);
    if (!parsed.success) return badRequest(reply, "Invalid time range", parsed.error.flatten());
    const data = getAppOverview(appId, parsed.data.timeRange);
    return {
      p95ReactRenderDuration: data.p95ReactRenderDuration,
      slowestReactCommits: data.slowestReactCommits,
      slowestRoutes: data.slowestRoutes,
      performanceEntries: listEvents(appId, { type: "performance", timeRange: parsed.data.timeRange, limit: 100 })
    };
  });

  app.get("/api/apps/:appId/network", async (request, reply) => {
    const appId = appIdFrom(request);
    if (!authorizeAppRead(request, reply, config, appId)) return;
    const parsed = eventFiltersSchema.pick({ timeRange: true }).safeParse(request.query);
    if (!parsed.success) return badRequest(reply, "Invalid time range", parsed.error.flatten());
    const data = getAppOverview(appId, parsed.data.timeRange);
    return {
      averageFetchDuration: data.averageFetchDuration,
      p95FetchDuration: data.p95FetchDuration,
      networkFailures: data.networkFailures,
      events: listEvents(appId, { type: "network", timeRange: parsed.data.timeRange, limit: 300 })
    };
  });

  app.post("/api/apps/:appId/source-maps", { bodyLimit: 10_500_000 }, async (request, reply) => {
    const appId = appIdFrom(request);
    const authorizedAppId = ingestionAppId(request, config);
    if (!authorizedAppId) return reply.status(401).send({ error: "Invalid or missing write key" });
    if (authorizedAppId !== "*" && authorizedAppId !== appId) return reply.status(403).send({ error: "Write key does not belong to this project" });
    const parsed = sourceMapUploadSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, "Invalid source map", parsed.error.flatten());
    try {
      JSON.parse(parsed.data.map);
    } catch {
      return reply.status(400).send({ error: "Source map must be valid JSON" });
    }
    saveSourceMap(appId, parsed.data.release, parsed.data.bundleName, parsed.data.map);
    return reply.status(201).send({ uploaded: true, release: parsed.data.release, bundleName: parsed.data.bundleName });
  });

  app.post("/api/apps/:appId/analyze", async (request, reply) => {
    const appId = appIdFrom(request);
    if (!authorizeAppManage(request, reply, config, appId)) return;
    const parsed = analyzeRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, "Invalid analysis request", parsed.error.flatten());
    const events = getRecentEvents(appId, 500, parsed.data.timeRange);
    try {
      const analysis = await analyzeWithOllama({ appId, events, ...parsed.data });
      const runId = recordAnalysis(appId, parsed.data.question, parsed.data.model, parsed.data.timeRange, analysis);
      audit(request, config, "analysis.created", appId, { runId, model: parsed.data.model, timeRange: parsed.data.timeRange });
      return { ...analysis, runId };
    } catch (error) {
      request.log.error(error);
      return reply.status(502).send({
        error: "Ollama analysis failed",
        message: error instanceof Error ? error.message : "Unknown error",
        hint: "Make sure Ollama is running locally and the selected model is pulled."
      });
    }
  });

  app.get("/api/apps/:appId/analyses", async (request, reply) => {
    const appId = appIdFrom(request);
    if (!authorizeAppRead(request, reply, config, appId)) return;
    return { runs: listAnalyses(appId) };
  });

  app.get("/api/ai/status", async (request, reply) => {
    if (!requireReadScope(request, reply, config)) return;
    return getOllamaStatus();
  });

  app.get("/api/apps/:appId/releases/compare", async (request, reply) => {
    const appId = appIdFrom(request);
    if (!authorizeAppRead(request, reply, config, appId)) return;
    const parsed = releaseComparisonSchema.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, "Invalid release comparison", parsed.error.flatten());
    return compareReleases(appId, parsed.data.base, parsed.data.target, parsed.data.timeRange);
  });

  app.get("/api/apps/:appId/alerts", async (request, reply) => {
    const appId = appIdFrom(request);
    if (!authorizeAppRead(request, reply, config, appId)) return;
    queueAlertWebhooks(evaluateAlerts(appId), config);
    return { rules: listAlertRules(appId), incidents: listAlertIncidents(appId), deliveries: listWebhookDeliveries(appId) };
  });

  app.post("/api/apps/:appId/alerts", async (request, reply) => {
    const appId = appIdFrom(request);
    if (!authorizeAppManage(request, reply, config, appId)) return;
    const parsed = alertRuleSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, "Invalid alert rule", parsed.error.flatten());
    if (parsed.data.webhookUrl) {
      const webhookError = validateWebhookUrl(parsed.data.webhookUrl, config);
      if (webhookError) return reply.status(400).send({ error: webhookError });
    }
    const rule = createAlertRule(appId, parsed.data);
    audit(request, config, "alert.created", appId, { ruleId: rule.id, metric: rule.metric, webhook: Boolean(rule.webhookUrl) });
    return reply.status(201).send(rule);
  });

  app.delete("/api/apps/:appId/alerts/:ruleId", async (request, reply) => {
    const appId = appIdFrom(request);
    if (!authorizeAppManage(request, reply, config, appId)) return;
    const { ruleId } = request.params as { ruleId: string };
    if (!deleteAlertRule(appId, ruleId)) return reply.status(404).send({ error: "Alert rule not found" });
    audit(request, config, "alert.deleted", appId, { ruleId });
    return reply.status(204).send();
  });

  app.get("/api/access-tokens", async (request, reply) => {
    if (!requireOwner(request, reply, config)) return;
    return { tokens: listAccessTokens() };
  });

  app.post("/api/access-tokens", async (request, reply) => {
    if (!requireOwner(request, reply, config)) return;
    const parsed = createAccessTokenSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, "Invalid access token", parsed.error.flatten());
    const value = `ri_access_${randomBytes(24).toString("hex")}`;
    const token = createAccessToken({ ...parsed.data, prefix: value.slice(0, 17), tokenHash: hashWriteKey(value) });
    audit(request, config, "access_token.created", undefined, { tokenId: token.id, role: token.role, appIds: token.appIds });
    return reply.status(201).send({ token, value });
  });

  app.delete("/api/access-tokens/:tokenId", async (request, reply) => {
    if (!requireOwner(request, reply, config)) return;
    const { tokenId } = request.params as { tokenId: string };
    if (!revokeAccessToken(tokenId)) return reply.status(404).send({ error: "Active access token not found" });
    audit(request, config, "access_token.revoked", undefined, { tokenId });
    return reply.status(204).send();
  });

  app.get("/api/audit-log", async (request, reply) => {
    const scope = requireReadScope(request, reply, config);
    if (!scope) return;
    return { entries: listAuditEntries(scope.all ? undefined : scope.appIds) };
  });

  return app;
}

function requireReadScope(request: FastifyRequest, reply: FastifyReply, config: ServerConfig) {
  const scope = readScope(request, config);
  if (!scope) reply.status(401).send({ error: "Invalid or missing dashboard token" });
  return scope;
}

function authorizeAppRead(request: FastifyRequest, reply: FastifyReply, config: ServerConfig, appId: string) {
  const scope = requireReadScope(request, reply, config);
  if (!scope) return false;
  if (!canReadApp(scope, appId)) {
    reply.status(403).send({ error: "Token cannot access this project" });
    return false;
  }
  return true;
}

function authorizeAppManage(request: FastifyRequest, reply: FastifyReply, config: ServerConfig, appId: string) {
  const scope = requireReadScope(request, reply, config);
  if (!scope) return false;
  if (!canManageApp(scope, appId)) {
    reply.status(403).send({ error: "Member or owner access to this project is required" });
    return false;
  }
  return true;
}

function requireOwner(request: FastifyRequest, reply: FastifyReply, config: ServerConfig) {
  const scope = requireReadScope(request, reply, config);
  if (!scope) return false;
  if (scope.role !== "owner") {
    reply.status(403).send({ error: "Owner dashboard token required" });
    return false;
  }
  return true;
}

function audit(request: FastifyRequest, config: ServerConfig, action: string, appId?: string, metadata?: Record<string, unknown>) {
  const scope = readScope(request, config);
  if (scope) recordAudit({ actor: scope.actor, role: scope.role, action, appId, metadata });
}

function rateLimitKey(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) return `credential:${hashWriteKey(authorization.slice(7))}`;
  return `ip:${request.ip}`;
}

function groupEventsByApp(events: IntelligenceEvent[]) {
  const groups = new Map<string, IntelligenceEvent[]>();
  for (const event of events) groups.set(event.appId, [...(groups.get(event.appId) ?? []), event]);
  return groups;
}

function appIdFrom(request: FastifyRequest) {
  return (request.params as { appId: string }).appId;
}

function badRequest(reply: FastifyReply, error: string, details: unknown) {
  return reply.status(400).send({ error, details });
}

function toCsv(events: IntelligenceEvent[]) {
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = events.map((event) => [event.id, event.type, event.timestamp, event.route, event.release, event.environment, JSON.stringify(event.payload)].map(escape).join(","));
  return [["id", "type", "timestamp", "route", "release", "environment", "payload"].join(","), ...rows].join("\n");
}

async function start() {
  const config = loadConfig();
  const app = await buildApp(config);
  await app.listen({ port: config.port, host: config.host });
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, "Graceful shutdown started");
    const forced = setTimeout(() => process.exit(1), 10_000);
    forced.unref();
    try {
      await app.close();
      process.exitCode = 0;
    } catch (error) {
      app.log.error(error, "Graceful shutdown failed");
      process.exitCode = 1;
    }
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

const isMain = process.argv[1] && canonicalPath(fileURLToPath(import.meta.url)) === canonicalPath(process.argv[1]);
if (isMain) await start();

function canonicalPath(path: string) {
  try { return realpathSync(path); } catch { return path; }
}
