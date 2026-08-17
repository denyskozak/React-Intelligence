import type {
  AccessRole,
  AccessTokenSummary,
  AlertIncident,
  AlertRule,
  AnalysisResponse,
  AppOverviewResponse,
  AuditEntry,
  ErrorIssue,
  ErrorIssueStatus,
  IngestionDiagnostics,
  IntelligenceEvent,
  OperationalMetrics,
  OverviewResponse,
  ProjectKeySummary,
  ProjectSummary,
  ReleaseMetrics,
  WebhookDelivery
} from "@react-intelligence/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const SESSION_TOKEN_KEY = "react-intelligence-dashboard-token";
const DEVELOPMENT_TOKEN = import.meta.env.DEV ? (import.meta.env.VITE_DASHBOARD_TOKEN ?? "ri_dev_dashboard") : "";
export const apiBaseUrl = API_URL || window.location.origin;
export const AUTH_EXPIRED_EVENT = "react-intelligence-auth-expired";

export function getDashboardToken() {
  try { return window.sessionStorage.getItem(SESSION_TOKEN_KEY) ?? DEVELOPMENT_TOKEN; } catch { return DEVELOPMENT_TOKEN; }
}

export function setDashboardToken(token: string) {
  window.sessionStorage.setItem(SESSION_TOKEN_KEY, token);
}

export function clearDashboardToken() {
  window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getDashboardToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers
    }
  });
  if (!response.ok) {
    if (response.status === 401) {
      clearDashboardToken();
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    throw new Error(await response.text());
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  me: () => request<{ actor: string; role: AccessRole; appIds: string[] | "all" }>("/api/auth/me"),
  overview: () => request<OverviewResponse>("/api/apps"),
  appOverview: (appId: string) => request<AppOverviewResponse>(`/api/apps/${appId}/overview`),
  events: (appId: string, params = new URLSearchParams()) => request<{ events: IntelligenceEvent[] }>(`/api/apps/${appId}/events?${params.toString()}`),
  errors: (appId: string) => request<{ groups: Array<Record<string, unknown>>; issues: ErrorIssue[]; events: IntelligenceEvent[] }>(`/api/apps/${appId}/errors`),
  issues: (appId: string, status: ErrorIssueStatus | "all" = "open") => request<{ issues: ErrorIssue[] }>(`/api/apps/${appId}/issues?status=${status}`),
  updateIssue: (appId: string, issueId: string, status: ErrorIssueStatus) => request<{ issue: ErrorIssue }>(`/api/apps/${appId}/issues/${issueId}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  performance: (appId: string) => request<Record<string, unknown>>(`/api/apps/${appId}/performance`),
  network: (appId: string) => request<Record<string, unknown>>(`/api/apps/${appId}/network`),
  analyze: (appId: string, body: { question: string; timeRange: string; model: string }) =>
    request<AnalysisResponse>(`/api/apps/${appId}/analyze`, { method: "POST", body: JSON.stringify(body) }),
  analysisHistory: (appId: string) => request<{ runs: Array<{ id: string; question: string; model: string; timeRange: string; response: AnalysisResponse; createdAt: string }> }>(`/api/apps/${appId}/analyses`),
  aiStatus: () => request<{ available: boolean; models: string[]; error?: string }>("/api/ai/status"),
  projects: () => request<{ projects: ProjectSummary[] }>("/api/projects"),
  createProject: (body: { appId: string; name: string }) => request<{ project: ProjectSummary; writeKey: string }>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  sendTestEvent: async (appId: string, writeKey: string) => {
    const response = await fetch(`${API_URL}/api/events/batch`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${writeKey}` },
      body: JSON.stringify({ events: [{
        id: crypto.randomUUID(), appId, sessionId: `dashboard-test-${crypto.randomUUID()}`,
        type: "custom", timestamp: new Date().toISOString(), schemaVersion: 1,
        sdkVersion: "dashboard-test", payload: { name: "connection_test", source: "onboarding" }
      }] })
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<{ accepted: number }>;
  },
  setRetention: (appId: string, retentionDays: number) => request<{ retentionDays: number; deleted: number }>(`/api/projects/${appId}/retention`, { method: "PATCH", body: JSON.stringify({ retentionDays }) }),
  setQuota: (appId: string, monthlyEventQuota: number) => request<IngestionDiagnostics>(`/api/projects/${appId}/quota`, { method: "PATCH", body: JSON.stringify({ monthlyEventQuota }) }),
  ingestion: (appId: string) => request<IngestionDiagnostics>(`/api/projects/${appId}/ingestion`),
  projectKeys: (appId: string) => request<{ keys: ProjectKeySummary[] }>(`/api/projects/${appId}/keys`),
  rotateProjectKey: (appId: string, body: { name: string; revokeExisting: boolean }) => request<{ key: ProjectKeySummary; writeKey: string }>(`/api/projects/${appId}/keys`, { method: "POST", body: JSON.stringify(body) }),
  revokeProjectKey: (appId: string, keyId: string) => request<void>(`/api/projects/${appId}/keys/${keyId}`, { method: "DELETE" }),
  deleteProjectData: (appId: string) => request<{ deleted: Record<string, number> }>(`/api/projects/${appId}/data`, { method: "DELETE", headers: { "x-confirm-app-id": appId } }),
  downloadExport: async (appId: string, format: "json" | "csv") => {
    const response = await fetch(`${API_URL}/api/projects/${encodeURIComponent(appId)}/export?format=${format}`, { headers: { authorization: `Bearer ${getDashboardToken()}` } });
    if (!response.ok) throw new Error(await response.text());
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${appId}-events.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  },
  compareReleases: (appId: string, base: string, target: string, timeRange = "30d") =>
    request<{ base: ReleaseMetrics; target: ReleaseMetrics }>(`/api/apps/${appId}/releases/compare?${new URLSearchParams({ base, target, timeRange })}`),
  alerts: (appId: string) => request<{ rules: AlertRule[]; incidents: AlertIncident[]; deliveries: WebhookDelivery[] }>(`/api/apps/${appId}/alerts`),
  createAlert: (appId: string, body: Omit<AlertRule, "id" | "appId" | "createdAt">) => request<AlertRule>(`/api/apps/${appId}/alerts`, { method: "POST", body: JSON.stringify(body) }),
  deleteAlert: (appId: string, ruleId: string) => request<void>(`/api/apps/${appId}/alerts/${ruleId}`, { method: "DELETE" }),
  accessTokens: () => request<{ tokens: AccessTokenSummary[] }>("/api/access-tokens"),
  createAccessToken: (body: { name: string; role: AccessRole; appIds: string[] }) => request<{ token: AccessTokenSummary; value: string }>("/api/access-tokens", { method: "POST", body: JSON.stringify(body) }),
  revokeAccessToken: (tokenId: string) => request<void>(`/api/access-tokens/${tokenId}`, { method: "DELETE" }),
  auditLog: () => request<{ entries: AuditEntry[] }>("/api/audit-log"),
  metrics: () => request<OperationalMetrics>("/metrics", { headers: { accept: "application/json" } })
};
