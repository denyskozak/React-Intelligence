import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Card, ErrorState, Loading, MetricCard } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "./hooks";

export function AppOverviewPage({ appId }: { appId: string }) {
  const { data, loading, error } = useAsync(() => api.appOverview(appId), [appId]);
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} />;
  if (!data) return null;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{appId}</h1>
          <p className="mt-1 text-sm text-muted">App overview, routes, errors and latency.</p>
        </div>
        <Badge tone={data.errorRate > 0.05 ? "bad" : "good"}>{Math.round(data.errorRate * 100)}% error rate · {data.timeRange}</Badge>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={`Events · ${data.timeRange}`} value={data.windowEvents} detail={`${data.app.totalEvents} all-time`} />
        <MetricCard label={`Sessions · ${data.timeRange}`} value={data.windowSessions} detail={`${data.app.totalSessions} all-time`} />
        <MetricCard label="p95 render" value={`${data.p95ReactRenderDuration}ms`} />
        <MetricCard label="p95 fetch" value={`${data.p95FetchDuration}ms`} detail={`avg ${data.averageFetchDuration}ms`} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="h-80">
          <h2 className="mb-4 font-semibold">Events Over Time</h2>
          <ResponsiveContainer width="100%" height="85%">
            <AreaChart data={data.eventsOverTime}><CartesianGrid stroke="#202a3a" /><XAxis dataKey="label" hide /><YAxis /><Tooltip /><Area dataKey="value" stroke="#38bdf8" fill="#0ea5e9" fillOpacity={0.18} /></AreaChart>
          </ResponsiveContainer>
        </Card>
        <Card className="h-80">
          <h2 className="mb-4 font-semibold">Top Routes By Errors</h2>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={data.topRoutesByErrors}><CartesianGrid stroke="#202a3a" /><XAxis dataKey="label" /><YAxis /><Tooltip /><Bar dataKey="value" fill="#ef4444" /></BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ListCard title="Slowest Routes" rows={data.slowestRoutes} suffix="ms" />
        <ListCard title="Console Warnings" rows={data.mostFrequentConsoleWarnings} />
        <Card>
          <h2 className="mb-4 font-semibold">Network Failures</h2>
          <div className="space-y-2">
            {data.networkFailures.slice(0, 6).map((event) => <p key={event.id} className="truncate rounded bg-ink p-2 text-sm">{String(event.payload.url)} · {String(event.payload.status ?? "failed")}</p>)}
            {!data.networkFailures.length && <p className="text-sm text-muted">No network failures.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}

function ListCard({ title, rows, suffix = "" }: { title: string; rows: Array<{ label: string; value: number }>; suffix?: string }) {
  return (
    <Card>
      <h2 className="mb-4 font-semibold">{title}</h2>
      <div className="space-y-2">
        {rows.length ? rows.map((row) => (
          <div key={row.label} className="flex justify-between rounded bg-ink p-2 text-sm"><span className="truncate">{row.label}</span><span className="text-muted">{row.value}{suffix}</span></div>
        )) : <p className="text-sm text-muted">No data.</p>}
      </div>
    </Card>
  );
}
