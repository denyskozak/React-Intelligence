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
  summary: string;
  findings: Array<{
    severity: "low" | "medium" | "high";
    title: string;
    evidence: string;
    recommendation: string;
  }>;
  suggestedQueries: string[];
}

export const intelligenceEventSchema = z.object({
  id: z.string().min(1),
  appId: z.string().min(1),
  sessionId: z.string().min(1),
  userId: z.string().optional(),
  type: z.enum(eventTypes),
  timestamp: z.string().datetime(),
  route: z.string().optional(),
  environment: z.string().optional(),
  release: z.string().optional(),
  payload: z.record(z.unknown())
});

export const batchEventsRequestSchema = z.object({
  events: z.array(intelligenceEventSchema).min(1).max(500)
});

export const analyzeRequestSchema = z.object({
  question: z.string().min(1).max(2000),
  timeRange: z.string().default("24h"),
  model: z.string().min(1).default("llama3.1")
});
