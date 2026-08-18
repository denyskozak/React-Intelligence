import { Link } from "react-router-dom";
import { Card, EmptyState, ErrorState, Loading, MetricCard } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "./hooks";

export function OverviewPage() {
  const { data, loading, error } = useAsync(api.overview, []);
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} />;
  if (!data || data.totalApps === 0) return <EmptyState title="No telemetry yet" description="Run pnpm seed or connect the SDK to your React app to start collecting events." />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="mt-1 text-sm text-muted">All React apps reporting runtime telemetry.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Apps" value={data.totalApps} />
        <MetricCard label="Events" value={data.totalEvents} />
        <MetricCard label="Errors" value={data.totalErrors} />
        <MetricCard label="Sessions" value={data.totalSessions} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <h2 className="mb-4 font-semibold">Recent Apps</h2>
          <div className="space-y-2">
            {data.apps.map((app) => (
              <Link key={app.appId} to={`/apps/${encodeURIComponent(app.appId)}`} className="flex items-center justify-between rounded-md border border-line p-3 hover:bg-line/40">
                <span>
                  <span className="block font-medium">{app.appId}</span>
                  <span className="text-xs text-muted">{app.environments.join(", ") || "unknown env"} · {app.releases.join(", ") || "no release"}</span>
                </span>
                <span className="text-right text-sm text-muted">{app.totalEvents} events<br />{app.totalErrors} errors</span>
              </Link>
            ))}
          </div>
        </Card>
        <Card>
          <h2 className="mb-4 font-semibold">Recent Critical Events</h2>
          <div className="space-y-3">
            {data.recentCriticalEvents.length ? data.recentCriticalEvents.map((event) => (
              <div key={event.id} className="rounded-md bg-ink p-3">
                <p className="text-sm font-medium">{String(event.payload.message ?? event.type)}</p>
                <p className="mt-1 text-xs text-muted">{event.route} · {new Date(event.timestamp).toLocaleString()}</p>
              </div>
            )) : <p className="text-sm text-muted">No critical events.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
