import type { ReleaseMetrics } from "@react-intelligence/shared";
import { useEffect, useState } from "react";
import { Card, ErrorState, Loading, MetricCard, SelectBox } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "./hooks";

export function ReleasesPage({ appId }: { appId: string }) {
  const overview = useAsync(() => api.appOverview(appId), [appId]);
  const releases = overview.data?.app.releases ?? [];
  const [base, setBase] = useState("");
  const [target, setTarget] = useState("");
  const [comparison, setComparison] = useState<{ base: ReleaseMetrics; target: ReleaseMetrics } | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (releases.length < 2) return;
    setBase((value) => value || releases[1]);
    setTarget((value) => value || releases[0]);
  }, [releases.join("|")]);
  useEffect(() => {
    if (!base || !target || base === target) return;
    api.compareReleases(appId, base, target).then(setComparison).catch(setError);
  }, [appId, base, target]);

  if (overview.loading) return <Loading />;
  if (overview.error) return <ErrorState error={overview.error} />;
  if (releases.length < 2) return <Card>At least two releases are required for comparison.</Card>;
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold">Release comparison</h1><p className="mt-1 text-sm text-muted">Compare error, network, and React render regressions over the last 30 days.</p></div>
    <Card className="flex items-center gap-4"><span className="text-sm text-muted">Base</span><SelectBox value={base} items={releases} onValueChange={setBase} /><span className="text-sm text-muted">Target</span><SelectBox value={target} items={releases} onValueChange={setTarget} /></Card>
    {error ? <ErrorState error={error} /> : null}
    {comparison ? <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DeltaCard label="Error rate" base={comparison.base.errorRate * 100} target={comparison.target.errorRate * 100} suffix="%" lowerIsBetter />
        <DeltaCard label="p95 React render" base={comparison.base.p95ReactRenderDuration} target={comparison.target.p95ReactRenderDuration} suffix="ms" lowerIsBetter />
        <DeltaCard label="p95 fetch" base={comparison.base.p95FetchDuration} target={comparison.target.p95FetchDuration} suffix="ms" lowerIsBetter />
        <DeltaCard label="Network failures" base={comparison.base.networkFailures} target={comparison.target.networkFailures} lowerIsBetter />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2"><ReleaseCard metrics={comparison.base} /><ReleaseCard metrics={comparison.target} /></div>
    </> : <Loading />}
  </div>;
}

function DeltaCard({ label, base, target, suffix = "", lowerIsBetter }: { label: string; base: number; target: number; suffix?: string; lowerIsBetter?: boolean }) {
  const delta = Math.round((target - base) * 100) / 100;
  const bad = lowerIsBetter && delta > 0;
  return <MetricCard label={label} value={`${Math.round(target * 100) / 100}${suffix}`} detail={`${delta >= 0 ? "+" : ""}${delta}${suffix} vs base${bad ? " · regression" : ""}`} />;
}

function ReleaseCard({ metrics }: { metrics: ReleaseMetrics }) {
  return <Card><h2 className="font-semibold">{metrics.release}</h2><dl className="mt-3 grid grid-cols-3 gap-3 text-sm"><div><dt className="text-muted">Events</dt><dd>{metrics.events}</dd></div><div><dt className="text-muted">Sessions</dt><dd>{metrics.sessions}</dd></div><div><dt className="text-muted">Errors</dt><dd>{metrics.errors}</dd></div></dl></Card>;
}
