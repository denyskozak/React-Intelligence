import { Badge, Card, ErrorState, Loading, MetricCard } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "./hooks";

export function ErrorsPage({ appId }: { appId: string }) {
  const { data, loading, error } = useAsync(() => api.errors(appId), [appId]);
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} />;
  const groups = data?.groups ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Errors</h1>
        <p className="mt-1 text-sm text-muted">Grouped React and browser errors.</p>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <MetricCard label="Error groups" value={groups.length} />
        <MetricCard label="Error events" value={data?.events.length ?? 0} />
        <MetricCard label="Affected routes" value={new Set(groups.flatMap((group) => group.routes as string[])).size} />
      </div>
      <div className="space-y-4">
        {groups.length ? groups.map((group) => (
          <Card key={String(group.message)}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold">{String(group.message)}</h2>
                <p className="mt-1 text-sm text-muted">Last seen {new Date(String(group.lastSeen)).toLocaleString()}</p>
              </div>
              <Badge tone="bad">{String(group.count)} hits</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">{((group.routes as string[]) ?? []).map((route) => <Badge key={route}>{route}</Badge>)}</div>
            {group.stack ? <pre className="mt-4 max-h-44 overflow-auto rounded bg-ink p-3 text-xs text-slate-300">{String(group.stack)}</pre> : null}
            {group.componentStack ? <pre className="mt-3 max-h-44 overflow-auto rounded bg-ink p-3 text-xs text-slate-300">{String(group.componentStack)}</pre> : null}
          </Card>
        )) : <Card><p className="text-sm text-muted">No errors collected for this app.</p></Card>}
      </div>
    </div>
  );
}
