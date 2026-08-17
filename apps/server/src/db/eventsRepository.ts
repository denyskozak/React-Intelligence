import {
  analysisResponseSchema,
  type AccessRole,
  type AccessTokenSummary,
  type AlertIncident,
  type AlertRule,
  type AuditEntry,
  type ErrorIssue,
  type ErrorIssueStatus,
  type IntelligenceEvent,
  type ProjectKeySummary,
  type ReleaseMetrics,
  type WebhookDelivery
} from "@react-intelligence/shared";
import { createHash } from "node:crypto";
import { db } from "./client.js";

export interface EventFilters {
  type?: string;
  route?: string;
  release?: string;
  environment?: string;
  search?: string;
  timeRange?: string;
  limit?: number;
  cursor?: string;
}

const insertEvent = db.prepare(`
  INSERT OR IGNORE INTO events
  (id, appId, sessionId, userId, type, timestamp, route, environment, release, schemaVersion, sdkVersion, sequence, serverReceivedAt, errorFingerprint, payload, createdAt)
  VALUES (@id, @appId, @sessionId, @userId, @type, @timestamp, @route, @environment, @release, @schemaVersion, @sdkVersion, @sequence, @serverReceivedAt, @errorFingerprint, @payload, @createdAt)
`);
const upsertApp = db.prepare(`
  INSERT INTO apps (appId, name, createdAt, lastSeen)
  VALUES (@appId, @appId, @now, @now)
  ON CONFLICT(appId) DO UPDATE SET lastSeen = excluded.lastSeen
`);
const upsertSession = db.prepare(`
  INSERT INTO sessions (id, appId, userId, environment, release, startedAt, lastSeen)
  VALUES (@id, @appId, @userId, @environment, @release, @now, @now)
  ON CONFLICT(id, appId) DO UPDATE SET lastSeen = excluded.lastSeen, userId = excluded.userId
`);

export const saveEvents = db.transaction((events: IntelligenceEvent[]) => {
  const now = new Date().toISOString();
  let accepted = 0;
  let duplicates = 0;
  for (const event of events) {
    const errorFingerprint = isError(event) ? fingerprintError(event) : null;
    const inserted = insertEvent.run({
      ...event,
      userId: event.userId ?? null,
      route: event.route ?? null,
      environment: event.environment ?? null,
      release: event.release ?? null,
      schemaVersion: event.schemaVersion ?? 1,
      sdkVersion: event.sdkVersion ?? null,
      sequence: event.sequence ?? null,
      serverReceivedAt: now,
      errorFingerprint,
      payload: JSON.stringify(event.payload),
      createdAt: now
    }).changes;
    if (!inserted) {
      duplicates += 1;
      continue;
    }
    accepted += 1;
    upsertApp.run({ appId: event.appId, now });
    upsertSession.run({
      id: event.sessionId,
      appId: event.appId,
      userId: event.userId,
      environment: event.environment,
      release: event.release,
      now
    });
    if (errorFingerprint) upsertErrorIssue(event, errorFingerprint);
  }
  return { accepted, duplicates };
});

export function filterUnseenEvents(events: IntelligenceEvent[]) {
  const unique = [...new Map(events.map((event) => [event.id, event])).values()];
  if (!unique.length) return [];
  const placeholders = unique.map(() => "?").join(",");
  const seen = new Set((db.prepare(`SELECT id FROM events WHERE id IN (${placeholders})`).all(...unique.map((event) => event.id)) as Array<{ id: string }>).map((row) => row.id));
  return unique.filter((event) => !seen.has(event.id));
}

export const backfillErrorIssues = db.transaction(() => {
  const rows = db.prepare(`SELECT * FROM events
    WHERE type IN ('error', 'react_error') AND errorFingerprint IS NULL ORDER BY timestamp ASC`).all() as any[];
  const update = db.prepare("UPDATE events SET errorFingerprint = ? WHERE id = ?");
  for (const row of rows) {
    const event = rowToEvent(row);
    const fingerprint = fingerprintError(event);
    update.run(fingerprint, event.id);
    upsertErrorIssue(event, fingerprint);
  }
  return rows.length;
});

export function listEvents(appId: string, filters: EventFilters = {}): IntelligenceEvent[] {
  const clauses = ["appId = @appId"];
  const params: Record<string, unknown> = { appId, limit: Math.min(filters.limit ?? 200, 1000) };
  for (const key of ["type", "route", "release", "environment"] as const) {
    if (filters[key]) {
      clauses.push(`${key} = @${key}`);
      params[key] = filters[key];
    }
  }
  if (filters.search) {
    clauses.push("(payload LIKE @search OR route LIKE @search OR sessionId LIKE @search)");
    params.search = `%${filters.search}%`;
  }

  if (filters.cursor) {
    clauses.push("timestamp < @cursor");
    params.cursor = filters.cursor;
  }

  const since = sinceForTimeRange(filters.timeRange);

  if (since) {
    clauses.push("timestamp >= @since")
    params.since = since;
  }
  return db
    .prepare(`SELECT * FROM events WHERE ${clauses.join(" AND ")} ORDER BY timestamp DESC LIMIT @limit`)
    .all(params)
    .map(rowToEvent);
}

function sinceForTimeRange(timeRange?: string) {
  if (!timeRange || timeRange === "all") return undefined;
  if (timeRange === "24h") return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  if (timeRange === "1h") return new Date(Date.now() - 60 * 60 * 1000).toISOString();
  if (timeRange === "7d") return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (timeRange === "30d") return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (timeRange === "all") return undefined;
  return undefined;
}

export function getRecentEvents(appId: string, limit = 500, timeRange = "24h"): IntelligenceEvent[] {
  return listEvents(appId, { limit, timeRange });
}

export function listApps(allowedAppIds?: Set<string>) {
  const apps = db
    .prepare(`
      SELECT
        a.appId,
        a.name,
        a.lastSeen,
        (SELECT COUNT(*) FROM events e WHERE e.appId = a.appId) as totalEvents,
        (SELECT COUNT(*) FROM sessions s WHERE s.appId = a.appId) as totalSessions,
        (SELECT COUNT(*) FROM events e WHERE e.appId = a.appId AND e.type IN ('error', 'react_error')) as totalErrors,
        (SELECT GROUP_CONCAT(DISTINCT e.environment) FROM events e WHERE e.appId = a.appId) as environments,
        (SELECT GROUP_CONCAT(release) FROM (
          SELECT e.release AS release FROM events e
          WHERE e.appId = a.appId AND e.release IS NOT NULL
          GROUP BY e.release ORDER BY MAX(e.timestamp) DESC
        )) as releases
      FROM apps a
      ORDER BY a.lastSeen DESC
    `)
    .all()
    .map((row: any) => ({
      appId: row.appId,
      name: row.name,
      environments: split(row.environments),
      releases: split(row.releases),
      totalEvents: Number(row.totalEvents ?? 0),
      totalSessions: Number(row.totalSessions ?? 0),
      totalErrors: Number(row.totalErrors ?? 0),
      lastSeen: row.lastSeen
    }));
  return allowedAppIds ? apps.filter((app) => allowedAppIds.has(app.appId)) : apps;
}

export function overview(allowedAppIds?: Set<string>) {
  const apps = listApps(allowedAppIds);
  const recentCriticalEvents = apps
    .flatMap((candidate) => listEvents(candidate.appId, { type: "error", timeRange: "24h", limit: 8 }).concat(listEvents(candidate.appId, { type: "react_error", timeRange: "24h", limit: 8 })))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 8);
  return {
    totalApps: apps.length,
    totalEvents: apps.reduce((sum, app) => sum + app.totalEvents, 0),
    totalSessions: apps.reduce((sum, app) => sum + app.totalSessions, 0),
    totalErrors: apps.reduce((sum, app) => sum + app.totalErrors, 0),
    apps,
    recentCriticalEvents
  };
}

export function getAppOverview(appId: string, timeRange = "24h") {
  const app = listApps().find((candidate) => candidate.appId === appId) ?? {
    appId,
    environments: [],
    releases: [],
    totalEvents: 0,
    totalSessions: 0,
    totalErrors: 0
  };
  const events = getRecentEvents(appId, 1000, timeRange);
  const network = events.filter((event) => event.type === "network");
  const profiler = events.filter((event) => event.type === "react_profiler");
  const fetchDurations = network.map(durationFromPayload).filter(isNumber).sort((a, b) => a - b);
  const renderDurations = profiler.map(durationFromPayload).filter(isNumber).sort((a, b) => a - b);
  const window = getWindowCounts(appId, timeRange);
  return {
    app,
    timeRange,
    windowEvents: window.events,
    windowSessions: window.sessions,
    windowErrors: window.errors,
    errorRate: window.events ? window.errors / window.events : 0,
    topRoutesByErrors: topBy(events.filter(isError), (event) => event.route ?? "unknown"),
    slowestRoutes: averageBy(profiler, (event) => event.route ?? "unknown", durationFromPayload),
    slowestReactCommits: profiler
      .map((event) => ({ ...event, duration: durationFromPayload(event) ?? 0 }))
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10),
    mostFrequentConsoleWarnings: topBy(events.filter((event) => event.type === "console" && event.payload.level === "warn"), (event) => String(event.payload.message ?? "warning")),
    networkFailures: network.filter((event) => event.payload.success === false || Number(event.payload.status ?? 200) >= 400).slice(0, 20),
    averageFetchDuration: average(fetchDurations),
    p95FetchDuration: percentile(fetchDurations, 95),
    p95ReactRenderDuration: percentile(renderDurations, 95),
    eventsOverTime: byHour(events),
    errorsOverTime: byHour(events.filter(isError))
  };
}

function getWindowCounts(appId: string, timeRange: string) {
  const since = sinceForTimeRange(timeRange);
  const row = db.prepare(`
    SELECT COUNT(*) AS events,
      COUNT(DISTINCT sessionId) AS sessions,
      SUM(CASE WHEN type IN ('error', 'react_error') THEN 1 ELSE 0 END) AS errors
    FROM events
    WHERE appId = @appId ${since ? "AND timestamp >= @since" : ""}
  `).get({ appId, since }) as { events: number; sessions: number; errors: number | null };
  return { events: Number(row.events), sessions: Number(row.sessions), errors: Number(row.errors ?? 0) };
}

export function groupedErrors(appId: string, timeRange = "24h") {
  const errors = listEvents(appId, { limit: 500, timeRange }).filter(isError);
  const groups = new Map<string, { message: string; count: number; lastSeen: string; routes: Set<string>; stack?: string; componentStack?: string }>();
  for (const event of errors) {
    const message = String(event.payload.message ?? event.payload.name ?? "Unknown error");
    const group = groups.get(message) ?? { message, count: 0, lastSeen: event.timestamp, routes: new Set(), stack: undefined, componentStack: undefined };
    group.count += 1;
    group.lastSeen = event.timestamp > group.lastSeen ? event.timestamp : group.lastSeen;
    if (event.route) group.routes.add(event.route);
    group.stack ||= String(event.payload.stack ?? "");
    group.componentStack ||= String(event.payload.componentStack ?? "");
    groups.set(message, group);
  }
  return [...groups.values()].map((group) => ({ ...group, routes: [...group.routes] })).sort((a, b) => b.count - a.count);
}

export function recordAnalysis(appId: string, question: string, model: string, timeRange: string, response: unknown) {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO analysis_runs (id, appId, question, model, timeRange, response, createdAt) VALUES (@id, @appId, @question, @model, @timeRange, @response, @createdAt)").run({
    id,
    appId,
    question,
    model,
    timeRange,
    response: JSON.stringify(response),
    createdAt: new Date().toISOString()
  });
  return id;
}

export function listAnalyses(appId: string, limit = 20) {
  return (db.prepare("SELECT * FROM analysis_runs WHERE appId = ? ORDER BY createdAt DESC LIMIT ?").all(appId, Math.min(limit, 100)) as any[])
    .map((row) => {
      const raw = JSON.parse(row.response) as Record<string, unknown>;
      const migrated = {
        ...raw,
        confidence: raw.confidence ?? 0,
        limitations: raw.limitations ?? ["Legacy analysis did not report confidence."],
        suggestedQueries: raw.suggestedQueries ?? [],
        findings: Array.isArray(raw.findings) ? raw.findings.map((finding: any) => ({
          ...finding,
          evidence: finding.evidence ?? "",
          evidenceEventIds: finding.evidenceEventIds ?? [],
          affectedRoutes: finding.affectedRoutes ?? []
        })) : []
      };
      return { ...row, response: analysisResponseSchema.parse(migrated) };
    });
}

function rowToEvent(row: any): IntelligenceEvent {
  return {
    id: row.id,
    appId: row.appId,
    sessionId: row.sessionId,
    userId: row.userId ?? undefined,
    type: row.type,
    timestamp: row.timestamp,
    route: row.route ?? undefined,
    environment: row.environment ?? undefined,
    release: row.release ?? undefined,
    schemaVersion: Number(row.schemaVersion ?? 1),
    sdkVersion: row.sdkVersion ?? undefined,
    sequence: row.sequence === null || row.sequence === undefined ? undefined : Number(row.sequence),
    serverReceivedAt: row.serverReceivedAt ?? undefined,
    errorFingerprint: row.errorFingerprint ?? undefined,
    payload: JSON.parse(row.payload)
  };
}

export function listErrorIssues(appId: string, status: ErrorIssueStatus | "all" = "open"): ErrorIssue[] {
  const rows = db.prepare(`SELECT * FROM error_issues WHERE appId = ? ${status === "all" ? "" : "AND status = ?"} ORDER BY lastSeen DESC LIMIT 500`)
    .all(...(status === "all" ? [appId] : [appId, status])) as any[];
  return rows.map((row) => ({
    ...row,
    eventCount: Number(row.eventCount),
    routes: JSON.parse(row.routes),
    releases: JSON.parse(row.releases),
    stack: row.stack ?? undefined,
    componentStack: row.componentStack ?? undefined,
    resolvedAt: row.resolvedAt ?? undefined,
    resolvedBy: row.resolvedBy ?? undefined
  }));
}

export function updateErrorIssueStatus(appId: string, issueId: string, status: ErrorIssueStatus, actor: string) {
  const resolved = status === "resolved" || status === "ignored";
  return db.prepare(`UPDATE error_issues SET status = ?, resolvedAt = ?, resolvedBy = ? WHERE id = ? AND appId = ?`)
    .run(status, resolved ? new Date().toISOString() : null, resolved ? actor : null, issueId, appId).changes > 0;
}

export function saveSourceMap(appId: string, release: string, bundleName: string, map: string) {
  db.prepare(`
    INSERT INTO source_maps (id, appId, release, bundleName, map, createdAt)
    VALUES (@id, @appId, @release, @bundleName, @map, @createdAt)
    ON CONFLICT(appId, release, bundleName) DO UPDATE SET map = excluded.map, createdAt = excluded.createdAt
  `).run({ id: crypto.randomUUID(), appId, release, bundleName, map, createdAt: new Date().toISOString() });
}

export function findSourceMaps(appId: string, release?: string) {
  if (!release) return [];
  return db.prepare("SELECT bundleName, map FROM source_maps WHERE appId = ? AND release = ?").all(appId, release) as Array<{ bundleName: string; map: string }>;
}

export function ensureProject(appId: string, name: string, writeKeyHash?: string, keyPrefix = "configured") {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO apps (appId, name, createdAt, lastSeen, writeKeyHash)
    VALUES (@appId, @name, @now, @now, @writeKeyHash)
    ON CONFLICT(appId) DO UPDATE SET
      name = COALESCE(excluded.name, apps.name),
      writeKeyHash = COALESCE(excluded.writeKeyHash, apps.writeKeyHash)
  `).run({ appId, name, now, writeKeyHash: writeKeyHash ?? null });
  if (writeKeyHash) {
    db.prepare(`INSERT OR IGNORE INTO project_keys (id, appId, name, prefix, keyHash, createdAt)
      VALUES (?, ?, 'Configured key', ?, ?, ?)`)
      .run(`configured-${appId}`, appId, keyPrefix, writeKeyHash, now);
  }
}

export function findAppIdByWriteKeyHash(writeKeyHash: string) {
  const key = db.prepare("SELECT id, appId FROM project_keys WHERE keyHash = ? AND revokedAt IS NULL").get(writeKeyHash) as { id: string; appId: string } | undefined;
  if (key) {
    db.prepare("UPDATE project_keys SET lastUsedAt = ? WHERE id = ?").run(new Date().toISOString(), key.id);
    return key.appId;
  }
  return (db.prepare(`SELECT a.appId FROM apps a WHERE a.writeKeyHash = ?
    AND NOT EXISTS (SELECT 1 FROM project_keys k WHERE k.appId = a.appId)`)
    .get(writeKeyHash) as { appId: string } | undefined)?.appId;
}

export function listProjects() {
  return (db.prepare(`
    SELECT a.appId, COALESCE(a.name, a.appId) AS name, a.retentionDays, a.lastSeen, a.monthlyEventQuota,
      EXISTS(SELECT 1 FROM events e WHERE e.appId = a.appId) AS connected,
      (SELECT sdkVersion FROM events e WHERE e.appId = a.appId ORDER BY timestamp DESC LIMIT 1) AS lastSdkVersion,
      (SELECT COALESCE(SUM(acceptedEvents), 0) FROM ingestion_daily u WHERE u.appId = a.appId AND u.day >= @month) AS monthlyEvents
    FROM apps a ORDER BY a.createdAt DESC
  `).all({ month: currentMonth() }) as any[]).map((row) => ({
    appId: row.appId,
    name: row.name,
    retentionDays: Number(row.retentionDays ?? 30),
    connected: Boolean(row.connected),
    lastSeen: row.connected ? row.lastSeen : undefined,
    lastSdkVersion: row.lastSdkVersion ?? undefined,
    monthlyEventQuota: Number(row.monthlyEventQuota ?? 100_000),
    monthlyEvents: Number(row.monthlyEvents ?? 0)
  }));
}

export function setRetention(appId: string, retentionDays: number) {
  return db.prepare("UPDATE apps SET retentionDays = ? WHERE appId = ?").run(retentionDays, appId).changes > 0;
}

export function setMonthlyEventQuota(appId: string, monthlyEventQuota: number) {
  return db.prepare("UPDATE apps SET monthlyEventQuota = ? WHERE appId = ?").run(monthlyEventQuota, appId).changes > 0;
}

export function getIngestionDiagnostics(appId: string) {
  const project = db.prepare("SELECT monthlyEventQuota FROM apps WHERE appId = ?").get(appId) as { monthlyEventQuota: number } | undefined;
  if (!project) return undefined;
  const row = db.prepare(`SELECT COALESCE(SUM(acceptedEvents), 0) AS acceptedEvents,
    COALESCE(SUM(rejectedEvents), 0) AS rejectedEvents, COALESCE(SUM(duplicateEvents), 0) AS duplicateEvents, MAX(lastAcceptedAt) AS lastAcceptedAt,
    MAX(lastRejectedAt) AS lastRejectedAt FROM ingestion_daily WHERE appId = ? AND day >= ?`)
    .get(appId, currentMonth()) as any;
  const acceptedEvents = Number(row.acceptedEvents ?? 0);
  return {
    appId,
    month: currentMonth().slice(0, 7),
    monthlyEventQuota: Number(project.monthlyEventQuota),
    acceptedEvents,
    rejectedEvents: Number(row.rejectedEvents ?? 0),
    duplicateEvents: Number(row.duplicateEvents ?? 0),
    remainingEvents: Math.max(0, Number(project.monthlyEventQuota) - acceptedEvents),
    lastAcceptedAt: row.lastAcceptedAt ?? undefined,
    lastRejectedAt: row.lastRejectedAt ?? undefined
  };
}

export function recordIngestion(appId: string, acceptedEvents: number, rejectedEvents: number, bytes: number, duplicateEvents = 0) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO ingestion_daily
    (appId, day, acceptedEvents, rejectedEvents, duplicateEvents, acceptedBytes, rejectedBytes, lastAcceptedAt, lastRejectedAt)
    VALUES (@appId, @day, @acceptedEvents, @rejectedEvents, @duplicateEvents, @acceptedBytes, @rejectedBytes, @lastAcceptedAt, @lastRejectedAt)
    ON CONFLICT(appId, day) DO UPDATE SET
      acceptedEvents = acceptedEvents + excluded.acceptedEvents,
      rejectedEvents = rejectedEvents + excluded.rejectedEvents,
      duplicateEvents = duplicateEvents + excluded.duplicateEvents,
      acceptedBytes = acceptedBytes + excluded.acceptedBytes,
      rejectedBytes = rejectedBytes + excluded.rejectedBytes,
      lastAcceptedAt = COALESCE(excluded.lastAcceptedAt, lastAcceptedAt),
      lastRejectedAt = COALESCE(excluded.lastRejectedAt, lastRejectedAt)`)
    .run({
      appId,
      day: now.slice(0, 10),
      acceptedEvents,
      rejectedEvents,
      duplicateEvents,
      acceptedBytes: acceptedEvents ? bytes : 0,
      rejectedBytes: rejectedEvents ? bytes : 0,
      lastAcceptedAt: acceptedEvents ? now : null,
      lastRejectedAt: rejectedEvents ? now : null
    });
}

export function createProjectKey(appId: string, name: string, prefix: string, keyHash: string, revokeExisting: boolean): ProjectKeySummary {
  const createdAt = new Date().toISOString();
  if (revokeExisting) db.prepare("UPDATE project_keys SET revokedAt = ? WHERE appId = ? AND revokedAt IS NULL").run(createdAt, appId);
  const key = { id: crypto.randomUUID(), appId, name, prefix, createdAt };
  db.prepare("INSERT INTO project_keys (id, appId, name, prefix, keyHash, createdAt) VALUES (@id, @appId, @name, @prefix, @keyHash, @createdAt)")
    .run({ ...key, keyHash });
  db.prepare("UPDATE apps SET writeKeyHash = ? WHERE appId = ?").run(keyHash, appId);
  return key;
}

export function listProjectKeys(appId: string): ProjectKeySummary[] {
  return db.prepare("SELECT id, name, prefix, createdAt, lastUsedAt, revokedAt FROM project_keys WHERE appId = ? ORDER BY createdAt DESC").all(appId) as ProjectKeySummary[];
}

export function revokeProjectKey(appId: string, keyId: string) {
  return db.prepare("UPDATE project_keys SET revokedAt = ? WHERE id = ? AND appId = ? AND revokedAt IS NULL")
    .run(new Date().toISOString(), keyId, appId).changes > 0;
}

export function createAccessToken(input: { name: string; role: AccessRole; appIds: string[]; prefix: string; tokenHash: string }): AccessTokenSummary {
  const token = { id: crypto.randomUUID(), name: input.name, prefix: input.prefix, role: input.role, appIds: input.appIds, createdAt: new Date().toISOString() };
  db.prepare(`INSERT INTO access_tokens (id, name, tokenHash, prefix, role, appIds, createdAt)
    VALUES (@id, @name, @tokenHash, @prefix, @role, @appIds, @createdAt)`)
    .run({ ...token, tokenHash: input.tokenHash, prefix: input.prefix, appIds: JSON.stringify(input.appIds) });
  return token;
}

export function findAccessTokenByHash(tokenHash: string) {
  const row = db.prepare("SELECT * FROM access_tokens WHERE tokenHash = ? AND revokedAt IS NULL").get(tokenHash) as any;
  if (!row) return undefined;
  const now = new Date().toISOString();
  db.prepare("UPDATE access_tokens SET lastUsedAt = ? WHERE id = ?").run(now, row.id);
  return { id: row.id, name: row.name, role: row.role as AccessRole, appIds: JSON.parse(row.appIds) as string[], lastUsedAt: now };
}

export function listAccessTokens(): AccessTokenSummary[] {
  return (db.prepare("SELECT id, name, prefix, role, appIds, createdAt, lastUsedAt, revokedAt FROM access_tokens ORDER BY createdAt DESC").all() as any[])
    .map((row) => ({ ...row, appIds: JSON.parse(row.appIds) }));
}

export function revokeAccessToken(tokenId: string) {
  return db.prepare("UPDATE access_tokens SET revokedAt = ? WHERE id = ? AND revokedAt IS NULL").run(new Date().toISOString(), tokenId).changes > 0;
}

export function recordAudit(entry: { actor: string; role: AccessRole; action: string; appId?: string; metadata?: Record<string, unknown> }) {
  db.prepare("INSERT INTO audit_log (id, actor, role, action, appId, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), entry.actor, entry.role, entry.action, entry.appId ?? null, JSON.stringify(entry.metadata ?? {}), new Date().toISOString());
}

export function listAuditEntries(allowedAppIds?: Set<string>, limit = 200): AuditEntry[] {
  const rows = db.prepare("SELECT * FROM audit_log ORDER BY createdAt DESC LIMIT ?").all(Math.min(limit, 500)) as any[];
  return rows.filter((row) => !allowedAppIds || (row.appId && allowedAppIds.has(row.appId)))
    .map((row) => ({ ...row, appId: row.appId ?? undefined, metadata: JSON.parse(row.metadata) }));
}

export function runRetention(appId?: string) {
  const projects = appId
    ? db.prepare("SELECT appId, retentionDays FROM apps WHERE appId = ?").all(appId)
    : db.prepare("SELECT appId, retentionDays FROM apps").all();
  let deleted = 0;
  const remove = db.prepare("DELETE FROM events WHERE appId = ? AND timestamp < ?");
  for (const project of projects as Array<{ appId: string; retentionDays: number }>) {
    const cutoff = new Date(Date.now() - project.retentionDays * 86_400_000).toISOString();
    deleted += remove.run(project.appId, cutoff).changes;
    db.prepare("DELETE FROM sessions WHERE appId = ? AND NOT EXISTS (SELECT 1 FROM events e WHERE e.appId = sessions.appId AND e.sessionId = sessions.id)").run(project.appId);
    db.prepare("DELETE FROM analysis_runs WHERE appId = ? AND createdAt < ?").run(project.appId, cutoff);
    db.prepare("DELETE FROM alert_incidents WHERE appId = ? AND triggeredAt < ?").run(project.appId, cutoff);
    db.prepare("DELETE FROM error_issues WHERE appId = ? AND lastSeen < ?").run(project.appId, cutoff);
  }
  return deleted;
}

export function exportEvents(appId: string) {
  return (db.prepare("SELECT * FROM events WHERE appId = ? ORDER BY timestamp ASC").all(appId) as any[]).map(rowToEvent);
}

export const deleteProjectData = db.transaction((appId: string) => {
  const counts = {
    events: db.prepare("DELETE FROM events WHERE appId = ?").run(appId).changes,
    sessions: db.prepare("DELETE FROM sessions WHERE appId = ?").run(appId).changes,
    analyses: db.prepare("DELETE FROM analysis_runs WHERE appId = ?").run(appId).changes,
    sourceMaps: db.prepare("DELETE FROM source_maps WHERE appId = ?").run(appId).changes,
    errorIssues: db.prepare("DELETE FROM error_issues WHERE appId = ?").run(appId).changes,
    alertRules: db.prepare("DELETE FROM alert_rules WHERE appId = ?").run(appId).changes,
    ingestionUsage: db.prepare("DELETE FROM ingestion_daily WHERE appId = ?").run(appId).changes
  };
  db.prepare("UPDATE apps SET lastSeen = createdAt WHERE appId = ?").run(appId);
  return counts;
});

export function compareReleases(appId: string, base: string, target: string, timeRange: string) {
  return {
    base: releaseMetrics(appId, base, timeRange),
    target: releaseMetrics(appId, target, timeRange)
  };
}

function releaseMetrics(appId: string, release: string, timeRange: string): ReleaseMetrics {
  const events = listEvents(appId, { release, timeRange, limit: 500 });
  const allCounts = db.prepare(`
    SELECT COUNT(*) AS events, COUNT(DISTINCT sessionId) AS sessions,
      SUM(CASE WHEN type IN ('error', 'react_error') THEN 1 ELSE 0 END) AS errors
    FROM events WHERE appId = @appId AND release = @release
      ${sinceForTimeRange(timeRange) ? "AND timestamp >= @since" : ""}
  `).get({ appId, release, since: sinceForTimeRange(timeRange) }) as { events: number; sessions: number; errors: number | null };
  const network = events.filter((event) => event.type === "network");
  const fetchDurations = network.map(durationFromPayload).filter(isNumber).sort((a, b) => a - b);
  const renderDurations = events.filter((event) => event.type === "react_profiler").map(durationFromPayload).filter(isNumber).sort((a, b) => a - b);
  const errors = Number(allCounts.errors ?? 0);
  return {
    release,
    events: Number(allCounts.events),
    sessions: Number(allCounts.sessions),
    errors,
    errorRate: allCounts.events ? errors / Number(allCounts.events) : 0,
    networkFailures: network.filter((event) => event.payload.success === false || Number(event.payload.status ?? 200) >= 400).length,
    p95FetchDuration: percentile(fetchDurations, 95),
    p95ReactRenderDuration: percentile(renderDurations, 95)
  };
}

export function createAlertRule(appId: string, input: Omit<AlertRule, "id" | "appId" | "createdAt">): AlertRule {
  const rule = { id: crypto.randomUUID(), appId, createdAt: new Date().toISOString(), ...input };
  db.prepare(`INSERT INTO alert_rules (id, appId, name, metric, threshold, timeRange, enabled, webhookUrl, createdAt)
    VALUES (@id, @appId, @name, @metric, @threshold, @timeRange, @enabled, @webhookUrl, @createdAt)`)
    .run({ ...rule, webhookUrl: rule.webhookUrl ?? null, enabled: rule.enabled ? 1 : 0 });
  return rule;
}

export function listAlertRules(appId: string): AlertRule[] {
  return (db.prepare("SELECT * FROM alert_rules WHERE appId = ? ORDER BY createdAt DESC").all(appId) as any[])
    .map((row) => ({ ...row, enabled: Boolean(row.enabled) }));
}

export function deleteAlertRule(appId: string, ruleId: string) {
  return db.prepare("DELETE FROM alert_rules WHERE id = ? AND appId = ?").run(ruleId, appId).changes > 0;
}

export function listAlertIncidents(appId: string): AlertIncident[] {
  return db.prepare("SELECT * FROM alert_incidents WHERE appId = ? ORDER BY triggeredAt DESC LIMIT 100").all(appId) as AlertIncident[];
}

export function evaluateAlerts(appId: string) {
  const notifications: Array<{ incident: AlertIncident; rule: AlertRule; event: "opened" | "resolved" }> = [];
  for (const rule of listAlertRules(appId).filter((candidate) => candidate.enabled)) {
    const overview = getAppOverview(appId, rule.timeRange);
    const value = rule.metric === "error_rate" ? overview.errorRate : rule.metric === "p95_render"
      ? overview.p95ReactRenderDuration : overview.networkFailures.length;
    const existing = db.prepare("SELECT id FROM alert_incidents WHERE ruleId = ? AND status = 'open'").get(rule.id) as { id: string } | undefined;
    if (value > rule.threshold && !existing) {
      const id = crypto.randomUUID();
      const triggeredAt = new Date().toISOString();
      db.prepare(`INSERT INTO alert_incidents (id, ruleId, appId, value, threshold, status, triggeredAt)
        VALUES (?, ?, ?, ?, ?, 'open', ?)`)
        .run(id, rule.id, appId, value, rule.threshold, triggeredAt);
      notifications.push({ incident: { id, ruleId: rule.id, appId, value, threshold: rule.threshold, status: "open", triggeredAt }, rule, event: "opened" });
    } else if (value <= rule.threshold && existing) {
      const resolvedAt = new Date().toISOString();
      db.prepare("UPDATE alert_incidents SET status = 'resolved', resolvedAt = ? WHERE id = ?")
        .run(resolvedAt, existing.id);
      const incident = db.prepare("SELECT * FROM alert_incidents WHERE id = ?").get(existing.id) as AlertIncident;
      notifications.push({ incident, rule, event: "resolved" });
    }
  }
  return notifications;
}

export function createWebhookDelivery(incidentId: string, appId: string, event: "opened" | "resolved"): WebhookDelivery {
  const delivery: WebhookDelivery = { id: crypto.randomUUID(), incidentId, appId, event, status: "pending", attempts: 0, createdAt: new Date().toISOString() };
  db.prepare(`INSERT INTO webhook_deliveries (id, incidentId, appId, event, status, attempts, createdAt)
    VALUES (@id, @incidentId, @appId, @event, @status, @attempts, @createdAt)`).run(delivery);
  return delivery;
}

export function finishWebhookDelivery(id: string, result: { status: "delivered" | "failed"; attempts: number; responseStatus?: number; lastError?: string }) {
  db.prepare(`UPDATE webhook_deliveries SET status = @status, attempts = @attempts, responseStatus = @responseStatus,
    lastError = @lastError, deliveredAt = @deliveredAt WHERE id = @id`).run({
      id,
      ...result,
      responseStatus: result.responseStatus ?? null,
      lastError: result.lastError ?? null,
      deliveredAt: result.status === "delivered" ? new Date().toISOString() : null
    });
}

export function listWebhookDeliveries(appId: string): WebhookDelivery[] {
  return db.prepare("SELECT * FROM webhook_deliveries WHERE appId = ? ORDER BY createdAt DESC LIMIT 100").all(appId) as WebhookDelivery[];
}

export function pendingWebhookJobs(limit = 50) {
  return db.prepare(`SELECT d.*, r.webhookUrl, r.name AS ruleName, i.value, i.threshold, i.status AS incidentStatus
    FROM webhook_deliveries d
    JOIN alert_incidents i ON i.id = d.incidentId
    JOIN alert_rules r ON r.id = i.ruleId
    WHERE d.status IN ('pending', 'failed') AND d.attempts < 3 AND r.webhookUrl IS NOT NULL
    ORDER BY d.createdAt ASC LIMIT ?`).all(limit) as Array<WebhookDelivery & {
      webhookUrl: string; ruleName: string; value: number; threshold: number; incidentStatus: string;
    }>;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7) + "-01";
}

function split(value?: string | null) {
  return value ? value.split(",").filter(Boolean) : [];
}

function isError(event: IntelligenceEvent) {
  return event.type === "error" || event.type === "react_error";
}

function fingerprintError(event: IntelligenceEvent) {
  const message = String(event.payload.message ?? event.payload.name ?? "Unknown error");
  const stack = String(event.payload.stack ?? event.payload.componentStack ?? "").split("\n").slice(0, 4).join("\n");
  const normalized = `${event.type}|${message}|${stack}`
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, "<uuid>")
    .replace(/:\d+:\d+/g, ":<line>")
    .replace(/\b\d+\b/g, "<number>");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

function upsertErrorIssue(event: IntelligenceEvent, fingerprint: string) {
  const existing = db.prepare("SELECT * FROM error_issues WHERE appId = ? AND fingerprint = ?").get(event.appId, fingerprint) as any;
  const title = String(event.payload.message ?? event.payload.name ?? "Unknown error").slice(0, 500);
  const routes = new Set<string>(existing ? JSON.parse(existing.routes) : []);
  const releases = new Set<string>(existing ? JSON.parse(existing.releases) : []);
  if (event.route) routes.add(event.route);
  if (event.release) releases.add(event.release);
  if (existing) {
    db.prepare(`UPDATE error_issues SET title = ?, status = 'open', lastSeen = ?, eventCount = eventCount + 1,
      lastEventId = ?, routes = ?, releases = ?, stack = COALESCE(?, stack), componentStack = COALESCE(?, componentStack),
      resolvedAt = NULL, resolvedBy = NULL WHERE id = ?`)
      .run(title, event.timestamp, event.id, JSON.stringify([...routes].slice(-50)), JSON.stringify([...releases].slice(-50)),
        event.payload.stack ? String(event.payload.stack) : null, event.payload.componentStack ? String(event.payload.componentStack) : null, existing.id);
    return;
  }
  db.prepare(`INSERT INTO error_issues
    (id, appId, fingerprint, title, status, firstSeen, lastSeen, eventCount, lastEventId, routes, releases, stack, componentStack)
    VALUES (?, ?, ?, ?, 'open', ?, ?, 1, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), event.appId, fingerprint, title, event.timestamp, event.timestamp, event.id,
      JSON.stringify([...routes]), JSON.stringify([...releases]), event.payload.stack ? String(event.payload.stack) : null,
      event.payload.componentStack ? String(event.payload.componentStack) : null);
}

function durationFromPayload(event: IntelligenceEvent) {
  const value = event.payload.actualDuration ?? event.payload.duration;
  return typeof value === "number" ? value : undefined;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function topBy(events: IntelligenceEvent[], keyFn: (event: IntelligenceEvent) => string, limit = 8) {
  const counts = new Map<string, number>();
  events.forEach((event) => counts.set(keyFn(event), (counts.get(keyFn(event)) ?? 0) + 1));
  return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, limit);
}

function averageBy(events: IntelligenceEvent[], keyFn: (event: IntelligenceEvent) => string, valueFn: (event: IntelligenceEvent) => number | undefined, limit = 8) {
  const buckets = new Map<string, number[]>();
  events.forEach((event) => {
    const value = valueFn(event);
    if (isNumber(value)) buckets.set(keyFn(event), [...(buckets.get(keyFn(event)) ?? []), value]);
  });
  return [...buckets.entries()].map(([label, values]) => ({ label, value: average(values) })).sort((a, b) => b.value - a.value).slice(0, limit);
}

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  return Math.round(values[Math.min(values.length - 1, Math.ceil((p / 100) * values.length) - 1)]);
}

function byHour(events: IntelligenceEvent[]) {
  const counts = new Map<string, number>();
  events.forEach((event) => {
    const label = new Date(event.timestamp).toISOString().slice(0, 13) + ":00";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => a.label.localeCompare(b.label)).slice(-24);
}
