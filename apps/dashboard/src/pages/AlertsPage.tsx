import type { AlertRule } from "@react-intelligence/shared";
import { Bell, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, Card, ErrorState, Loading, SelectBox } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "./hooks";

export function AlertsPage({ appId, canManage }: { appId: string; canManage: boolean }) {
  const { data, loading, error, setData } = useAsync(() => api.alerts(appId), [appId]);
  const [metric, setMetric] = useState<AlertRule["metric"]>("error_rate");
  const [threshold, setThreshold] = useState("0.05");
  const [webhookUrl, setWebhookUrl] = useState("");
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} />;

  async function createRule() {
    const rule = await api.createAlert(appId, { name: `${metric} above ${threshold}`, metric, threshold: Number(threshold), timeRange: "1h", enabled: true, webhookUrl: webhookUrl || undefined });
    setData({ rules: [rule, ...(data?.rules ?? [])], incidents: data?.incidents ?? [], deliveries: data?.deliveries ?? [] });
  }

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold">Alerts</h1><p className="mt-1 text-sm text-muted">Evaluate key regressions against the latest one-hour telemetry window.</p></div>
    {canManage ? <Card>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_1.4fr_auto]">
        <SelectBox value={metric} items={["error_rate", "p95_render", "network_failures"]} onValueChange={(value) => setMetric(value as AlertRule["metric"])} />
        <input type="number" step="0.01" min="0" value={threshold} onChange={(event) => setThreshold(event.target.value)} className="rounded-md border border-line bg-ink px-3 text-sm" />
        <input type="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://hooks.example.com/… (optional)" className="rounded-md border border-line bg-ink px-3 text-sm" />
        <button onClick={createRule} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink">Create rule</button>
      </div>
      <p className="mt-2 text-xs text-muted">Error rate uses 0–1 values; for example 0.05 means 5%.</p>
    </Card> : <Card><p className="text-sm text-muted">Viewer access can inspect alert rules, incidents, and delivery history. Member access is required to change rules.</p></Card>}
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card><h2 className="mb-3 font-semibold">Rules</h2><div className="space-y-2">{(data?.rules ?? []).map((rule) => <div key={rule.id} className="flex items-center justify-between rounded bg-ink p-3 text-sm"><span>{rule.name}<span className="ml-2 text-xs text-muted">{rule.timeRange}{rule.webhookUrl ? " · webhook" : ""}</span></span>{canManage ? <button title="Delete alert rule" onClick={async () => { await api.deleteAlert(appId, rule.id); setData({ rules: data!.rules.filter((candidate) => candidate.id !== rule.id), incidents: data!.incidents, deliveries: data!.deliveries }); }} className="text-bad"><Trash2 size={15} /></button> : null}</div>)}</div></Card>
      <Card><h2 className="mb-3 flex items-center gap-2 font-semibold"><Bell size={16} /> Incidents</h2><div className="space-y-2">{(data?.incidents ?? []).map((incident) => <div key={incident.id} className="rounded bg-ink p-3 text-sm"><div className="flex justify-between"><span>Value {incident.value} exceeded {incident.threshold}</span><Badge tone={incident.status === "open" ? "bad" : "good"}>{incident.status}</Badge></div><p className="mt-1 text-xs text-muted">{new Date(incident.triggeredAt).toLocaleString()}</p></div>)}{!data?.incidents.length ? <p className="text-sm text-muted">No incidents.</p> : null}</div></Card>
    </div>
    <Card><h2 className="mb-3 font-semibold">Webhook deliveries</h2><div className="space-y-2">{(data?.deliveries ?? []).map((delivery) => <div key={delivery.id} className="flex items-center justify-between rounded bg-ink p-3 text-sm"><span>{delivery.event} · attempt {delivery.attempts}/3</span><Badge tone={delivery.status === "delivered" ? "good" : delivery.status === "failed" ? "bad" : "warn"}>{delivery.status}</Badge></div>)}{!data?.deliveries.length ? <p className="text-sm text-muted">No webhook deliveries.</p> : null}</div></Card>
  </div>;
}
