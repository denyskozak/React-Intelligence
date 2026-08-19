import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, ErrorState, Loading, MetricCard } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "./hooks";

export function PerformancePage({ appId }: { appId: string }) {
  const { data, loading, error } = useAsync(() => api.performance(appId), [appId]);
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} />;
  const commits = (data?.slowestReactCommits as Array<{ id: string; route?: string; duration: number; payload: Record<string, unknown> }>) ?? [];
  const routes = (data?.slowestRoutes as Array<{ label: string; value: number }>) ?? [];
  const entries = (data?.performanceEntries as Array<{ id: string; payload: Record<string, unknown>; route?: string }>) ?? [];
  const avg = commits.length ? Math.round(commits.reduce((sum, item) => sum + item.duration, 0) / commits.length) : 0;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Performance</h1>
        <p className="mt-1 text-sm text-muted">React Profiler commits, route cost and browser timing.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard label="p95 actualDuration" value={`${String(data?.p95ReactRenderDuration ?? 0)}ms`} />
        <MetricCard label="Average slow commit" value={`${avg}ms`} />
        <MetricCard label="Browser timing entries" value={entries.length} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="h-80">
          <h2 className="mb-4 font-semibold">Route Performance</h2>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={routes}><CartesianGrid stroke="#202a3a" /><XAxis dataKey="label" /><YAxis /><Tooltip /><Bar dataKey="value" fill="#38bdf8" /></BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <h2 className="mb-4 font-semibold">Browser Performance Entries</h2>
          <div className="space-y-2">
            {entries.slice(0, 8).map((event) => (
              <div key={event.id} className="rounded bg-ink p-3 text-sm">
                <span className="font-medium">{String(event.payload.kind)}</span>
                <span className="ml-2 text-muted">{String(event.payload.duration ?? event.payload.load ?? "-")}ms · {event.route}</span>
              </div>
            ))}
            {!entries.length && <p className="text-sm text-muted">No performance entries yet.</p>}
          </div>
        </Card>
      </div>
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-ink text-xs uppercase text-muted"><tr><th className="p-3">Component</th><th>Route</th><th>Phase</th><th>Actual Duration</th><th>Base Duration</th></tr></thead>
          <tbody>{commits.map((event) => (
            <tr key={event.id} className="border-t border-line"><td className="p-3">{String(event.payload.id)}</td><td>{event.route}</td><td>{String(event.payload.phase)}</td><td>{event.duration}ms</td><td>{String(event.payload.baseDuration ?? "-")}ms</td></tr>
          ))}</tbody>
        </table></div>
      </Card>
    </div>
  );
}
