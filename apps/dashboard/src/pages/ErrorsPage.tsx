import type { ErrorIssueStatus } from "@react-intelligence/shared";
import { useState } from "react";
import { Badge, Card, ErrorState, Loading, MetricCard, SelectBox } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "./hooks";

export function ErrorsPage({ appId }: { appId: string }) {
  const { data, loading, error, setData } = useAsync(() => api.errors(appId), [appId]);
  const [status, setStatus] = useState<ErrorIssueStatus | "all">("open");
  const [actionError, setActionError] = useState("");
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} />;
  const issues = (data?.issues ?? []).filter((issue) => status === "all" || issue.status === status);
  const allIssues = data?.issues ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Errors</h1>
        <p className="mt-1 text-sm text-muted">Stable error fingerprints with an open, resolved, or ignored triage workflow.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Open issues" value={allIssues.filter((issue) => issue.status === "open").length} />
        <MetricCard label="Resolved" value={allIssues.filter((issue) => issue.status === "resolved").length} />
        <MetricCard label="Error events" value={data?.events.length ?? 0} />
        <MetricCard label="Affected routes" value={new Set(allIssues.flatMap((issue) => issue.routes)).size} />
      </div>
      <div className="flex items-center justify-between"><h2 className="font-semibold">Issues</h2><SelectBox value={status} items={["open", "resolved", "ignored", "all"]} onValueChange={(value) => setStatus(value as ErrorIssueStatus | "all")} /></div>
      {actionError ? <ErrorState error={actionError} /> : null}
      <div className="space-y-4">
        {issues.length ? issues.map((issue) => (
          <Card key={issue.id}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2"><h2 className="font-semibold">{issue.title}</h2><Badge tone={issue.status === "open" ? "bad" : issue.status === "resolved" ? "good" : "neutral"}>{issue.status}</Badge></div>
                <p className="mt-1 text-sm text-muted">First seen {new Date(issue.firstSeen).toLocaleString()} · last seen {new Date(issue.lastSeen).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2"><Badge tone="bad">{issue.eventCount} hits</Badge>{issue.status === "open" ? <><button onClick={() => void changeStatus(issue.id, "resolved")} className="rounded border border-good/40 px-3 py-1 text-xs text-good">Resolve</button><button onClick={() => void changeStatus(issue.id, "ignored")} className="rounded border border-line px-3 py-1 text-xs">Ignore</button></> : <button onClick={() => void changeStatus(issue.id, "open")} className="rounded border border-line px-3 py-1 text-xs">Reopen</button>}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">{issue.routes.map((route) => <Badge key={route}>{route}</Badge>)}{issue.releases.map((release) => <Badge key={release} tone="warn">{release}</Badge>)}</div>
            {issue.stack ? <pre className="mt-4 max-h-44 overflow-auto rounded bg-ink p-3 text-xs text-slate-300">{issue.stack}</pre> : null}
            {issue.componentStack ? <pre className="mt-3 max-h-44 overflow-auto rounded bg-ink p-3 text-xs text-slate-300">{issue.componentStack}</pre> : null}
          </Card>
        )) : <Card><p className="text-sm text-muted">No {status === "all" ? "" : status} issues for this app.</p></Card>}
      </div>
    </div>
  );

  async function changeStatus(issueId: string, nextStatus: ErrorIssueStatus) {
    if (!data) return;
    try {
      const result = await api.updateIssue(appId, issueId, nextStatus);
      setData({ ...data, issues: data.issues.map((issue) => issue.id === issueId ? result.issue : issue) });
      setActionError("");
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : "Issue update failed");
    }
  }
}
