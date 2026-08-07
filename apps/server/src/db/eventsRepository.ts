import type { IntelligenceEvent } from "@react-intelligence/shared";
import { db } from "./client.js";

export interface EventFilters {
  type?: string;
  route?: string;
  release?: string;
  environment?: string;
  search?: string;
  timeRange?:string;
  limit?: number;
}

const insertEvent = db.prepare(`
  INSERT OR IGNORE INTO events
  (id, appId, sessionId, userId, type, timestamp, route, environment, release, payload, createdAt)
  VALUES (@id, @appId, @sessionId, @userId, @type, @timestamp, @route, @environment, @release, @payload, @createdAt)
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
  for (const event of events) {
    upsertApp.run({ appId: event.appId, now });
    upsertSession.run({
      id: event.sessionId,
      appId: event.appId,
      userId: event.userId,
      environment: event.environment,
      release: event.release,
      now
    });
    insertEvent.run({
      ...event,
      userId: event.userId ?? null,
      route: event.route ?? null,
      environment: event.environment ?? null,
      release: event.release ?? null,
      payload: JSON.stringify(event.payload),
      createdAt: now
    });
  }
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
  if (!timeRange || timeRange === "24h") return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  if (timeRange === "1h") return new Date(Date.now() - 60 * 60 * 1000).toISOString();
  if (timeRange === "7d") return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (timeRange === "30d") return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (timeRange === "all") return undefined;
  return undefined;
}

export function getRecentEvents(appId: string, limit = 500): IntelligenceEvent[] {
  return listEvents(appId, { limit });
}

export function listApps() {
  return db
    .prepare(`
      SELECT
        a.appId,
        a.name,
        a.lastSeen,
        COUNT(DISTINCT e.id) as totalEvents,
        COUNT(DISTINCT s.id) as totalSessions,
        COUNT(DISTINCT CASE WHEN e.type IN ('error', 'react_error') THEN e.id END) as totalErrors,
        GROUP_CONCAT(DISTINCT e.environment) as environments,
        GROUP_CONCAT(DISTINCT e.release) as releases
      FROM apps a
      LEFT JOIN events e ON e.appId = a.appId
      LEFT JOIN sessions s ON s.appId = a.appId
      GROUP BY a.appId
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
}

export function overview() {
  const apps = listApps();
  const recentCriticalEvents = db
    .prepare("SELECT * FROM events WHERE type IN ('error', 'react_error') ORDER BY timestamp DESC LIMIT 8")
    .all()
    .map(rowToEvent);
  return {
    totalApps: apps.length,
    totalEvents: apps.reduce((sum, app) => sum + app.totalEvents, 0),
    totalSessions: apps.reduce((sum, app) => sum + app.totalSessions, 0),
    totalErrors: apps.reduce((sum, app) => sum + app.totalErrors, 0),
    apps,
    recentCriticalEvents
  };
}

export function getAppOverview(appId: string) {
  const app = listApps().find((candidate) => candidate.appId === appId) ?? {
    appId,
    environments: [],
    releases: [],
    totalEvents: 0,
    totalSessions: 0,
    totalErrors: 0
  };
  const events = getRecentEvents(appId, 1000);
  const network = events.filter((event) => event.type === "network");
  const profiler = events.filter((event) => event.type === "react_profiler");
  const fetchDurations = network.map(durationFromPayload).filter(isNumber).sort((a, b) => a - b);
  const renderDurations = profiler.map(durationFromPayload).filter(isNumber).sort((a, b) => a - b);
  return {
    app,
    errorRate: app.totalEvents ? app.totalErrors / app.totalEvents : 0,
    topRoutesByErrors: topBy(events.filter(isError), (event) => event.route ?? "unknown"),
    slowestRoutes: averageBy(events.filter((event) => event.type === "react_profiler" || event.type === "network"), (event) => event.route ?? "unknown", durationFromPayload),
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

export function groupedErrors(appId: string) {
  const errors = listEvents(appId, { limit: 1000 }).filter(isError);
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

export function recordAnalysis(appId: string, question: string, model: string, timeRange?: string, response: unknown) {
  db.prepare("INSERT INTO analysis_runs (id, appId, question, model, timeRange, response, createdAt) VALUES (@id, @appId, @question, @model, @timeRange, @response, @createdAt)").run({
    id: crypto.randomUUID(),
    appId,
    question,
    model,
    timeRange,
    response: JSON.stringify(response),
    createdAt: new Date().toISOString()
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
    payload: JSON.parse(row.payload)
  };
}

function split(value?: string | null) {
  return value ? value.split(",").filter(Boolean) : [];
}

function isError(event: IntelligenceEvent) {
  return event.type === "error" || event.type === "react_error";
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
