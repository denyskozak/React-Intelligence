import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Badge, Card, ErrorState, Loading, MetricCard } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "./hooks";

export function NetworkPage({ appId }: { appId: string }) {
  const { data, loading, error } = useAsync(() => api.network(appId), [appId]);
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} />;
  const events = ((data?.events as NetworkEvent[]) ?? []) as NetworkEvent[];
  const failures = (data?.networkFailures as NetworkEvent[]) ?? [];
  const status = statusDistribution(events);
  const slowest = [...events].sort((a, b) => duration(b) - duration(a)).slice(0, 12);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Network</h1>
        <p className="mt-1 text-sm text-muted">Fetch durations, status distribution and failed requests.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Requests" value={events.length} />
        <MetricCard label="Failures" value={failures.length} />
        <MetricCard label="Average duration" value={`${String(data?.averageFetchDuration ?? 0)}ms`} />
        <MetricCard label="p95 duration" value={`${String(data?.p95FetchDuration ?? 0)}ms`} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.7fr_1.3fr]">
        <Card className="h-80">
          <h2 className="mb-4 font-semibold">Status Codes</h2>
          <ResponsiveContainer width="100%" height="85%">
            <PieChart><Pie data={status} dataKey="value" nameKey="label" outerRadius={92}>{status.map((entry, index) => <Cell key={entry.label} fill={index ? "#ef4444" : "#22c55e"} />)}</Pie><Tooltip /></PieChart>
          </ResponsiveContainer>
        </Card>
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-ink text-xs uppercase text-muted"><tr><th className="p-3">URL</th><th>Route</th><th>Status</th><th>Duration</th><th>Result</th></tr></thead>
            <tbody>{slowest.map((event) => (
              <tr key={event.id} className="border-t border-line"><td className="max-w-md truncate p-3">{String(event.payload.url)}</td><td>{event.route}</td><td>{String(event.payload.status ?? "-")}</td><td>{duration(event)}ms</td><td><Badge tone={event.payload.success === false ? "bad" : "good"}>{event.payload.success === false ? "failed" : "ok"}</Badge></td></tr>
            ))}</tbody>
          </table></div>
        </Card>
      </div>
    </div>
  );
}

type NetworkEvent = { id: string; route?: string; payload: Record<string, unknown> };

function duration(event: NetworkEvent) {
  return Number(event.payload.duration ?? 0);
}

function statusDistribution(events: NetworkEvent[]) {
  const counts = new Map<string, number>();
  events.forEach((event) => {
    const label = String(event.payload.status ?? "failed");
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  return [...counts.entries()].map(([label, value]) => ({ label, value }));
}
