import type { AccessRole } from "@react-intelligence/shared";
import { Copy, Database, RefreshCw, Shield, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, Card, ErrorState, Loading, MetricCard, SelectBox } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "./hooks";

export function AdminPage() {
  const { data, loading, error, setData } = useAsync(async () => {
    const [tokens, audit, metrics] = await Promise.all([api.accessTokens(), api.auditLog(), api.metrics()]);
    return { tokens: tokens.tokens, audit: audit.entries, metrics };
  }, []);
  const [name, setName] = useState("");
  const [role, setRole] = useState<AccessRole>("viewer");
  const [appIds, setAppIds] = useState("");
  const [tokenValue, setTokenValue] = useState("");
  const [integrity, setIntegrity] = useState<Awaited<ReturnType<typeof api.integrity>>>();
  const [integrityLoading, setIntegrityLoading] = useState(false);
  const [actionError, setActionError] = useState<unknown>();

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} />;
  if (!data) return null;

  async function runIntegrityCheck() {
    setIntegrityLoading(true);
    setActionError(undefined);
    try { setIntegrity(await api.integrity()); }
    catch (nextError) { setActionError(nextError); }
    finally { setIntegrityLoading(false); }
  }

  return <div className="space-y-6">
    <div>
      <h1 className="text-2xl font-semibold">Access & operations</h1>
      <p className="mt-1 text-sm text-muted">Issue least-privilege tokens, verify storage health, and review administrative actions.</p>
    </div>
    {actionError ? <ErrorState error={actionError} /> : null}
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Server uptime" value={`${Math.floor(data.metrics.uptimeSeconds / 60)}m`} />
      <MetricCard label="HTTP requests" value={data.metrics.requestsTotal} detail={Object.entries(data.metrics.requestsByStatus).map(([status, count]) => `${status}: ${count}`).join(" · ")} />
      <MetricCard label="Stored events" value={data.metrics.database.events} detail={`${data.metrics.database.projects} projects`} />
      <MetricCard label="Ingestion since start" value={data.metrics.acceptedEvents} detail={`${data.metrics.duplicateEvents} duplicates · ${data.metrics.rejectedEvents} rejected`} />
    </div>
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><Database size={17} /> Database integrity</h2>
          <p className="mt-1 text-sm text-muted">Run after a restore or upgrade. It is intentionally separate from frequent readiness probes.</p>
        </div>
        <button disabled={integrityLoading} onClick={() => void runIntegrityCheck()} className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm hover:bg-line disabled:opacity-50">
          <RefreshCw size={15} className={integrityLoading ? "animate-spin" : ""} /> {integrityLoading ? "Checking…" : "Run check"}
        </button>
      </div>
      {integrity ? <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={integrity.ok ? "good" : "bad"}>{integrity.ok ? "healthy" : "failed"}</Badge>
        <span>{integrity.result}</span>
        <span className="text-muted">{integrity.durationMs} ms · {new Date(integrity.checkedAt).toLocaleString()}</span>
      </div> : null}
    </Card>
    <Card>
      <h2 className="flex items-center gap-2 font-semibold"><Shield size={17} /> Create access token</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_160px_1fr_auto]">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Frontend team" className="h-10 rounded-md border border-line bg-ink px-3 text-sm" />
        <SelectBox value={role} items={["viewer", "member", "owner"]} onValueChange={(value) => setRole(value as AccessRole)} />
        <input value={appIds} onChange={(event) => setAppIds(event.target.value)} placeholder={role === "owner" ? "All projects" : "demo-app, checkout-ui"} disabled={role === "owner"} className="h-10 rounded-md border border-line bg-ink px-3 text-sm disabled:opacity-50" />
        <button onClick={async () => {
          setActionError(undefined);
          try {
            const result = await api.createAccessToken({ name, role, appIds: role === "owner" ? [] : appIds.split(",").map((item) => item.trim()).filter(Boolean) });
            setTokenValue(result.value);
            setData({ ...data, tokens: [result.token, ...data.tokens] });
            setName("");
          } catch (nextError) { setActionError(nextError); }
        }} disabled={!name || (role !== "owner" && !appIds)} className="h-10 rounded-md bg-accent px-4 text-sm font-semibold text-ink disabled:opacity-50">Create</button>
      </div>
      {tokenValue ? <div className="mt-3 flex items-center gap-3 rounded border border-warn/40 bg-ink p-3"><Badge tone="warn">shown once</Badge><code className="min-w-0 flex-1 truncate text-xs">{tokenValue}</code><button aria-label="Copy access token" onClick={() => void navigator.clipboard.writeText(tokenValue)}><Copy size={16} /></button></div> : null}
      <div className="mt-4 space-y-2">{data.tokens.map((token) => <div key={token.id} className="flex flex-wrap items-center justify-between gap-3 rounded bg-ink p-3 text-sm"><div><span className="font-medium">{token.name}</span><Badge tone={token.role === "owner" ? "bad" : token.role === "member" ? "warn" : "neutral"}>{token.role}</Badge><code className="ml-2 text-xs text-muted">{token.prefix}…</code><p className="mt-1 text-xs text-muted">{token.appIds.join(", ") || "all projects"} · {token.lastUsedAt ? `used ${new Date(token.lastUsedAt).toLocaleString()}` : "never used"}</p></div>{token.revokedAt ? <Badge>revoked</Badge> : <button aria-label={`Revoke ${token.name}`} onClick={async () => { try { await api.revokeAccessToken(token.id); setData({ ...data, tokens: data.tokens.map((candidate) => candidate.id === token.id ? { ...candidate, revokedAt: new Date().toISOString() } : candidate) }); } catch (nextError) { setActionError(nextError); } }} className="text-bad"><Trash2 size={15} /></button>}</div>)}</div>
    </Card>
    <Card className="overflow-hidden p-0">
      <div className="p-4"><h2 className="font-semibold">Audit log</h2></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-ink text-xs uppercase text-muted"><tr><th className="p-3">Time</th><th>Actor</th><th>Role</th><th>Action</th><th>Project</th></tr></thead><tbody>{data.audit.map((entry) => <tr key={entry.id} className="border-t border-line"><td className="p-3 text-xs text-muted">{new Date(entry.createdAt).toLocaleString()}</td><td>{entry.actor}</td><td>{entry.role}</td><td>{entry.action}</td><td>{entry.appId ?? "—"}</td></tr>)}</tbody></table></div>
    </Card>
  </div>;
}
