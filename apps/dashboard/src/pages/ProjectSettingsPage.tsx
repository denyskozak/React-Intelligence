import { Copy, KeyRound, RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, Card, ErrorState, Loading, MetricCard } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "./hooks";

export function ProjectSettingsPage({ appId }: { appId: string }) {
  const { data, loading, error, setData } = useAsync(async () => {
    const [ingestion, keys] = await Promise.all([api.ingestion(appId), api.projectKeys(appId)]);
    return { ingestion, keys: keys.keys };
  }, [appId]);
  const [quota, setQuota] = useState("");
  const [newWriteKey, setNewWriteKey] = useState("");
  const [keyName, setKeyName] = useState("Primary");

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} />;
  if (!data) return null;
  const usagePercent = data.ingestion.monthlyEventQuota ? Math.min(100, Math.round(data.ingestion.acceptedEvents / data.ingestion.monthlyEventQuota * 100)) : 0;

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold">Project settings</h1><p className="mt-1 text-sm text-muted">Manage ingestion capacity and revocable SDK credentials for {appId}.</p></div>
    <div className="grid grid-cols-5 gap-4">
      <MetricCard label={`Accepted · ${data.ingestion.month}`} value={data.ingestion.acceptedEvents} detail={`${usagePercent}% of quota`} />
      <MetricCard label="Remaining" value={data.ingestion.remainingEvents} />
      <MetricCard label="Rejected" value={data.ingestion.rejectedEvents} />
      <MetricCard label="Deduplicated" value={data.ingestion.duplicateEvents} />
      <MetricCard label="Monthly quota" value={data.ingestion.monthlyEventQuota} />
    </div>
    <Card>
      <h2 className="font-semibold">Usage quota</h2>
      <div className="mt-3 flex gap-3"><input type="number" min="100" value={quota} onChange={(event) => setQuota(event.target.value)} placeholder={String(data.ingestion.monthlyEventQuota)} className="rounded-md border border-line bg-ink px-3 text-sm" /><button onClick={async () => { const ingestion = await api.setQuota(appId, Number(quota)); setData({ ...data, ingestion }); setQuota(""); }} disabled={!quota} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">Update quota</button></div>
    </Card>
    <Card>
      <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><KeyRound size={17} /> Write keys</h2><Badge tone="warn">Values are shown once</Badge></div>
      <div className="mt-3 flex gap-3"><input value={keyName} onChange={(event) => setKeyName(event.target.value)} className="rounded-md border border-line bg-ink px-3 text-sm" /><button onClick={async () => { const result = await api.rotateProjectKey(appId, { name: keyName, revokeExisting: true }); setNewWriteKey(result.writeKey); setData({ ...data, keys: [result.key, ...data.keys.map((key) => key.revokedAt ? key : { ...key, revokedAt: new Date().toISOString() })] }); }} className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink"><RotateCw size={15} /> Rotate and revoke old</button></div>
      {newWriteKey ? <div className="mt-3 flex items-center gap-3 rounded border border-warn/40 bg-ink p-3"><code className="min-w-0 flex-1 truncate text-xs">{newWriteKey}</code><button onClick={() => void navigator.clipboard.writeText(newWriteKey)}><Copy size={16} /></button></div> : null}
      <div className="mt-4 space-y-2">{data.keys.map((key) => <div key={key.id} className="flex items-center justify-between rounded bg-ink p-3 text-sm"><div><span className="font-medium">{key.name}</span><code className="ml-2 text-xs text-muted">{key.prefix}…</code><p className="mt-1 text-xs text-muted">Created {new Date(key.createdAt).toLocaleString()} · {key.lastUsedAt ? `last used ${new Date(key.lastUsedAt).toLocaleString()}` : "never used"}</p></div><div className="flex items-center gap-2">{key.revokedAt ? <Badge>revoked</Badge> : <><Badge tone="good">active</Badge><button title="Revoke key" onClick={async () => { await api.revokeProjectKey(appId, key.id); setData({ ...data, keys: data.keys.map((candidate) => candidate.id === key.id ? { ...candidate, revokedAt: new Date().toISOString() } : candidate) }); }} className="text-bad"><Trash2 size={15} /></button></>}</div></div>)}</div>
    </Card>
  </div>;
}
