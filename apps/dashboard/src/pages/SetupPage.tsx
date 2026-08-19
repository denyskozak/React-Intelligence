import { CheckCircle2, Copy, Download, Plug, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, Card, ErrorState, Loading, SelectBox } from "../components/ui";
import { api, apiBaseUrl } from "../lib/api";
import { useAsync } from "./hooks";

export function SetupPage() {
  const { data, loading, error, setData } = useAsync(api.projects, []);
  const [appId, setAppId] = useState("");
  const [name, setName] = useState("");
  const [writeKey, setWriteKey] = useState("");
  const [createdAppId, setCreatedAppId] = useState("");
  const [actionError, setActionError] = useState("");
  const [testStatus, setTestStatus] = useState("");

  async function createProject() {
    setActionError("");
    try {
      const result = await api.createProject({ appId, name });
      setWriteKey(result.writeKey);
      setCreatedAppId(result.project.appId);
      setData({ projects: [result.project, ...(data?.projects ?? [])] });
      setAppId("");
      setName("");
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : "Project creation failed");
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} />;
  const snippet = writeKey ? `const telemetry = {\n  appId: "${createdAppId}",\n  endpoint: "${apiBaseUrl}",\n  writeKey: "${writeKey}",\n  processingMode: "local" as const\n};\n\nconfigureReactIntelligence(telemetry);` : "";

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold">Connect a React app</h1><p className="mt-1 text-sm text-muted">Create a project, copy the one-time write key, then wait for the first SDK event.</p></div>
      <Card>
        <h2 className="font-semibold">1. Create project</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_auto]">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Checkout UI" className="rounded-md border border-line bg-ink px-3 text-sm" />
          <input value={appId} onChange={(event) => setAppId(event.target.value)} placeholder="checkout-ui" className="rounded-md border border-line bg-ink px-3 text-sm" />
          <button onClick={createProject} disabled={!name.trim() || !appId.trim()} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">Create</button>
        </div>
        {actionError ? <p className="mt-3 text-sm text-bad">{actionError}</p> : null}
      </Card>
      {writeKey ? <Card className="border-good/40">
        <div className="flex items-center justify-between"><h2 className="font-semibold">2. Install SDK</h2><Badge tone="warn">Key shown once</Badge></div>
        <pre className="mt-4 overflow-x-auto rounded bg-ink p-4 text-xs text-slate-300">{snippet}</pre>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={() => void navigator.clipboard.writeText(snippet)} className="flex items-center gap-2 rounded border border-line px-3 py-2 text-sm"><Copy size={15} /> Copy snippet</button>
          <button onClick={async () => {
            await api.sendTestEvent(createdAppId, writeKey);
            setTestStatus("Test event accepted");
            setData(await api.projects());
          }} className="flex items-center gap-2 rounded border border-good/40 px-3 py-2 text-sm text-good"><Plug size={15} /> Send test event</button>
          {testStatus ? <span className="text-sm text-good">{testStatus}</span> : null}
        </div>
      </Card> : null}
      <Card>
        <div className="flex items-center justify-between"><h2 className="font-semibold">3. Verify connection</h2><button onClick={() => void api.projects().then(setData)} className="rounded border border-line px-3 py-2 text-sm">Refresh</button></div>
        <div className="mt-4 space-y-3">
          {(data?.projects ?? []).map((project) => (
            <div key={project.appId} className="flex items-center justify-between rounded-md border border-line p-3">
              <div className="flex items-center gap-3">
                {project.connected ? <CheckCircle2 className="text-good" size={20} /> : <Plug className="text-muted" size={20} />}
                <div><p className="font-medium">{project.name} <span className="text-xs text-muted">· {project.appId}</span></p><p className="text-xs text-muted">{project.connected ? `Connected · SDK ${project.lastSdkVersion ?? "unknown"} · ${new Date(project.lastSeen!).toLocaleString()}` : "Waiting for first SDK event"}</p></div>
              </div>
              <div className="flex items-center gap-2">
                <SelectBox value={String(project.retentionDays)} items={["7", "30", "90", "180", "365"]} onValueChange={async (value) => {
                  await api.setRetention(project.appId, Number(value));
                  setData({ projects: (data?.projects ?? []).map((candidate) => candidate.appId === project.appId ? { ...candidate, retentionDays: Number(value) } : candidate) });
                }} />
                <button title="Export JSON" onClick={() => void api.downloadExport(project.appId, "json")} className="rounded border border-line p-2"><Download size={16} /></button>
                <button title="Delete telemetry" onClick={async () => {
                  if (!window.confirm(`Delete all telemetry for ${project.appId}?`)) return;
                  await api.deleteProjectData(project.appId);
                  setData({ projects: (data?.projects ?? []).map((candidate) => candidate.appId === project.appId ? { ...candidate, connected: false, lastSeen: undefined } : candidate) });
                }} className="rounded border border-bad/40 p-2 text-bad"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
