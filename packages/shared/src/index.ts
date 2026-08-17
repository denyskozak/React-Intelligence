import { z } from "zod";

export const eventTypes = [
  "error",
  "react_error",
  "performance",
  "react_profiler",
  "network",
  "console",
  "user_action",
  "route_change",
  "custom"
] as const;

export type EventType = (typeof eventTypes)[number];

export interface IntelligenceEvent {
  id: string;
  appId: string;
  sessionId: string;
  userId?: string;
  type: EventType;
  timestamp: string;
  route?: string;
  environment?: string;
  release?: string;
  schemaVersion?: number;
  sdkVersion?: string;
  sequence?: number;
  serverReceivedAt?: string;
  errorFingerprint?: string;
  payload: Record<string, unknown>;
}

export interface BatchEventsRequest {
  events: IntelligenceEvent[];
}

export interface AppSummary {
  appId: string;
  name?: string;
  environments: string[];
  releases: string[];
  totalEvents: number;
  totalSessions: number;
  totalErrors: number;
  lastSeen?: string;
}

export interface OverviewResponse {
  totalApps: number;
  totalEvents: number;
  totalSessions: number;
  totalErrors: number;
  apps: AppSummary[];
  recentCriticalEvents: IntelligenceEvent[];
}

export interface MetricPoint {
  label: string;
  value: number;
}

export interface AppOverviewResponse {
  app: AppSummary;
  timeRange: string;
  windowEvents: number;
  windowSessions: number;
  windowErrors: number;
  errorRate: number;
  topRoutesByErrors: MetricPoint[];
  slowestRoutes: MetricPoint[];
  slowestReactCommits: Array<IntelligenceEvent & { duration: number }>;
  mostFrequentConsoleWarnings: MetricPoint[];
  networkFailures: IntelligenceEvent[];
  averageFetchDuration: number;
  p95FetchDuration: number;
  p95ReactRenderDuration: number;
  eventsOverTime: MetricPoint[];
  errorsOverTime: MetricPoint[];
}

export interface AnalysisResponse {
  runId?: string;
  summary: string;
  findings: Array<{
    severity: "low" | "medium" | "high";
    title: string;
    evidence: string;
    evidenceEventIds: string[];
    affectedRoutes: string[];
    recommendation: string;
  }>;
  confidence: number;
  limitations: string[];
  suggestedQueries: string[];
}

export interface ProjectSummary {
  appId: string;
  name: string;
  retentionDays: number;
  connected: boolean;
  lastSeen?: string;
  lastSdkVersion?: string;
  monthlyEventQuota: number;
  monthlyEvents: number;
}

export type AccessRole = "owner" | "member" | "viewer";

export interface AccessTokenSummary {
  id: string;
  name: string;
  prefix: string;
  role: AccessRole;
  appIds: string[];
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface ProjectKeySummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface IngestionDiagnostics {
  appId: string;
  month: string;
  monthlyEventQuota: number;
  acceptedEvents: number;
  rejectedEvents: number;
  duplicateEvents: number;
  remainingEvents: number;
  lastAcceptedAt?: string;
  lastRejectedAt?: string;
}

export type ErrorIssueStatus = "open" | "resolved" | "ignored";

export interface ErrorIssue {
  id: string;
  appId: string;
  fingerprint: string;
  title: string;
  status: ErrorIssueStatus;
  firstSeen: string;
  lastSeen: string;
  eventCount: number;
  lastEventId: string;
  routes: string[];
  releases: string[];
  stack?: string;
  componentStack?: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface OperationalMetrics {
  uptimeSeconds: number;
  requestsTotal: number;
  requestsByStatus: Record<string, number>;
  ingestionBatches: number;
  acceptedEvents: number;
  duplicateEvents: number;
  rejectedEvents: number;
  webhookDeliveries: Record<string, number>;
  database: { events: number; projects: number; sizeBytes: number };
}

export interface AuditEntry {
  id: string;
  actor: string;
  role: AccessRole;
  action: string;
  appId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ReleaseMetrics {
  release: string;
  events: number;
  sessions: number;
  errors: number;
  errorRate: number;
  networkFailures: number;
  p95FetchDuration: number;
  p95ReactRenderDuration: number;
}

export interface AlertRule {
  id: string;
  appId: string;
  name: string;
  metric: "error_rate" | "p95_render" | "network_failures";
  threshold: number;
  timeRange: "1h" | "24h";
  enabled: boolean;
  webhookUrl?: string;
  createdAt: string;
}

export interface AlertIncident {
  id: string;
  ruleId: string;
  appId: string;
  value: number;
  threshold: number;
  status: "open" | "resolved";
  triggeredAt: string;
  resolvedAt?: string;
}

export interface WebhookDelivery {
  id: string;
  incidentId: string;
  appId: string;
  event: "opened" | "resolved";
  status: "pending" | "delivered" | "failed";
  attempts: number;
  responseStatus?: number;
  lastError?: string;
  createdAt: string;
  deliveredAt?: string;
}

const boundedIdentifier = z.string().min(1).max(128);
export const timeRangeSchema = z.enum(["1h", "24h", "7d", "30d", "all"]);

export const intelligenceEventSchema = z.object({
  id: z.string().uuid(),
  appId: boundedIdentifier,
  sessionId: boundedIdentifier,
  userId: z.string().max(256).optional(),
  type: z.enum(eventTypes),
  timestamp: z.string().datetime(),
  route: z.string().max(2048).optional(),
  environment: z.string().max(64).optional(),
  release: z.string().max(128).optional(),
  schemaVersion: z.number().int().min(1).max(100).default(1),
  sdkVersion: z.string().max(64).optional(),
  sequence: z.number().int().nonnegative().optional(),
  payload: z.record(z.unknown())
});

export const batchEventsRequestSchema = z.object({
  events: z.array(intelligenceEventSchema).min(1).max(100)
});

export const eventFiltersSchema = z.object({
  type: z.enum(eventTypes).optional(),
  route: z.string().max(2048).optional(),
  release: z.string().max(128).optional(),
  environment: z.string().max(64).optional(),
  search: z.string().max(256).optional(),
  timeRange: timeRangeSchema.default("24h"),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  cursor: z.string().datetime().optional()
});

export const sourceMapUploadSchema = z.object({
  release: z.string().min(1).max(128),
  bundleName: z.string().min(1).max(512),
  map: z.string().min(2).max(10_000_000)
});

export const createProjectSchema = z.object({
  appId: boundedIdentifier.regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  name: z.string().min(1).max(128)
});

export const retentionSchema = z.object({
  retentionDays: z.number().int().min(1).max(365)
});

export const quotaSchema = z.object({
  monthlyEventQuota: z.number().int().min(100).max(1_000_000_000)
});

export const rotateProjectKeySchema = z.object({
  name: z.string().min(1).max(128).default("Primary"),
  revokeExisting: z.boolean().default(true)
});

export const createAccessTokenSchema = z.object({
  name: z.string().min(1).max(128),
  role: z.enum(["owner", "member", "viewer"]),
  appIds: z.array(boundedIdentifier).max(100).default([])
}).superRefine((value, context) => {
  if (value.role !== "owner" && value.appIds.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["appIds"], message: "Member and viewer tokens require at least one project" });
  }
});

export const releaseComparisonSchema = z.object({
  base: z.string().min(1).max(128),
  target: z.string().min(1).max(128),
  timeRange: timeRangeSchema.default("30d")
});

export const alertRuleSchema = z.object({
  name: z.string().min(1).max(128),
  metric: z.enum(["error_rate", "p95_render", "network_failures"]),
  threshold: z.number().min(0).max(1_000_000),
  timeRange: z.enum(["1h", "24h"]).default("1h"),
  enabled: z.boolean().default(true),
  webhookUrl: z.string().url().max(2048).optional()
});

export const issueStatusSchema = z.object({
  status: z.enum(["open", "resolved", "ignored"])
});

export const analysisResponseSchema = z.object({
  summary: z.string().min(1).max(5000),
  findings: z.array(z.object({
    severity: z.enum(["low", "medium", "high"]),
    title: z.string().min(1).max(300),
    evidence: z.string().max(2000).default(""),
    evidenceEventIds: z.array(z.string()).max(20).default([]),
    affectedRoutes: z.array(z.string()).max(20).default([]),
    recommendation: z.string().min(1).max(3000)
  })).max(20),
  confidence: z.number().min(0).max(1).default(0),
  limitations: z.array(z.string().max(1000)).max(20).default([]),
  suggestedQueries: z.array(z.string().max(500)).max(10).default([])
});

export const analyzeRequestSchema = z.object({
  question: z.string().min(1).max(2000),
  timeRange: timeRangeSchema.default("24h"),
  model: z.string().min(1).max(128).default("llama3.1")
});
