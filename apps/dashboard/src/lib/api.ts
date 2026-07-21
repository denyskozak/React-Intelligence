import type { AnalysisResponse, AppOverviewResponse, IntelligenceEvent, OverviewResponse } from "@react-intelligence/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers }
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export const api = {
  overview: () => request<OverviewResponse>("/api/apps"),
  appOverview: (appId: string) => request<AppOverviewResponse>(`/api/apps/${appId}/overview`),
  events: (appId: string, params = new URLSearchParams()) => request<{ events: IntelligenceEvent[] }>(`/api/apps/${appId}/events?${params.toString()}`),
  errors: (appId: string) => request<{ groups: Array<Record<string, unknown>>; events: IntelligenceEvent[] }>(`/api/apps/${appId}/errors`),
  performance: (appId: string) => request<Record<string, unknown>>(`/api/apps/${appId}/performance`),
  network: (appId: string) => request<Record<string, unknown>>(`/api/apps/${appId}/network`),
  analyze: (appId: string, body: { question: string; timeRange: string; model: string }) =>
    request<AnalysisResponse>(`/api/apps/${appId}/analyze`, { method: "POST", body: JSON.stringify(body) })
};
