import type { OperationalMetrics } from "@react-intelligence/shared";
import { statSync } from "node:fs";
import { db, dbPath } from "../db/client.js";

let startedAt = Date.now();
let requestsTotal = 0;
let ingestionBatches = 0;
let acceptedEvents = 0;
let duplicateEvents = 0;
let rejectedEvents = 0;
const requestsByStatus = new Map<string, number>();

export function resetOperationalMetrics() {
  startedAt = Date.now();
  requestsTotal = 0;
  ingestionBatches = 0;
  acceptedEvents = 0;
  duplicateEvents = 0;
  rejectedEvents = 0;
  requestsByStatus.clear();
}

export function recordRequest(statusCode: number) {
  requestsTotal += 1;
  const family = `${Math.floor(statusCode / 100)}xx`;
  requestsByStatus.set(family, (requestsByStatus.get(family) ?? 0) + 1);
}

export function recordIngestionMetrics(input: { accepted: number; duplicates: number; rejected: number }) {
  ingestionBatches += 1;
  acceptedEvents += input.accepted;
  duplicateEvents += input.duplicates;
  rejectedEvents += input.rejected;
}

export function collectOperationalMetrics(): OperationalMetrics {
  const counts = db.prepare(`SELECT
    (SELECT COUNT(*) FROM events) AS events,
    (SELECT COUNT(*) FROM apps) AS projects`).get() as { events: number; projects: number };
  const webhookRows = db.prepare("SELECT status, COUNT(*) AS count FROM webhook_deliveries GROUP BY status").all() as Array<{ status: string; count: number }>;
  let sizeBytes = 0;
  try { sizeBytes = statSync(dbPath).size; } catch { /* In-memory and not-yet-created databases have no file size. */ }
  return {
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    requestsTotal,
    requestsByStatus: Object.fromEntries(requestsByStatus),
    ingestionBatches,
    acceptedEvents,
    duplicateEvents,
    rejectedEvents,
    webhookDeliveries: Object.fromEntries(webhookRows.map((row) => [row.status, Number(row.count)])),
    database: { events: Number(counts.events), projects: Number(counts.projects), sizeBytes }
  };
}

export function prometheusMetrics(metrics = collectOperationalMetrics()) {
  const lines = [
    "# HELP react_intelligence_uptime_seconds Server process uptime.",
    "# TYPE react_intelligence_uptime_seconds gauge",
    `react_intelligence_uptime_seconds ${metrics.uptimeSeconds}`,
    "# HELP react_intelligence_http_requests_total HTTP responses since process start.",
    "# TYPE react_intelligence_http_requests_total counter",
    `react_intelligence_http_requests_total ${metrics.requestsTotal}`,
    ...Object.entries(metrics.requestsByStatus).map(([status, count]) => `react_intelligence_http_responses_total{status_family="${status}"} ${count}`),
    `react_intelligence_ingestion_batches_total ${metrics.ingestionBatches}`,
    `react_intelligence_ingestion_events_total{result="accepted"} ${metrics.acceptedEvents}`,
    `react_intelligence_ingestion_events_total{result="duplicate"} ${metrics.duplicateEvents}`,
    `react_intelligence_ingestion_events_total{result="rejected"} ${metrics.rejectedEvents}`,
    `react_intelligence_database_events ${metrics.database.events}`,
    `react_intelligence_database_projects ${metrics.database.projects}`,
    `react_intelligence_database_size_bytes ${metrics.database.sizeBytes}`,
    ...Object.entries(metrics.webhookDeliveries).map(([status, count]) => `react_intelligence_webhook_deliveries{status="${status}"} ${count}`)
  ];
  return `${lines.join("\n")}\n`;
}
