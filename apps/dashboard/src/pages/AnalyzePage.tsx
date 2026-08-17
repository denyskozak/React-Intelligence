import { Bot, History, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, SelectBox } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "./hooks";

const suggestions = [
  "Which components are causing the most render cost?",
  "Why are users seeing errors on checkout?",
  "Which routes are slowest?",
  "What changed after the latest release?",
  "Find suspicious network failures.",
  "Summarize the last 24 hours."
];

export function AnalyzePage({ appId }: { appId: string }) {
  const [question, setQuestion] = useState(suggestions[0]);
  const [model, setModel] = useState("llama3.1");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.analyze>> | null>(null);
  const [error, setError] = useState("");
  const status = useAsync(api.aiStatus, []);
  const history = useAsync(() => api.analysisHistory(appId), [appId]);
  const models = status.data?.models.length ? status.data.models : ["llama3.1", "llama3", "mistral", "codellama"];

  useEffect(() => {
    if (status.data?.models.length && !status.data.models.includes(model)) setModel(status.data.models[0]);
  }, [status.data?.models.join("|")]);

  async function analyze() {
    setLoading(true);
    setError("");
    try {
      const nextResult = await api.analyze(appId, { question, model, timeRange: "24h" });
      setResult(nextResult);
      history.setData({ runs: [{ id: nextResult.runId ?? crypto.randomUUID(), question, model, timeRange: "24h", response: nextResult, createdAt: new Date().toISOString() }, ...(history.data?.runs ?? [])] });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AI Analysis</h1>
        <div className="mt-1 flex items-center gap-2 text-sm text-muted">Ask local Ollama to reason over collected telemetry. <Badge tone={status.data?.available ? "good" : "bad"}>{status.data?.available ? "model online" : "model offline"}</Badge></div>
      </div>
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted"><Bot size={16} /> Ollama model</div>
          <SelectBox value={model} onValueChange={setModel} items={models} />
        </div>
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} className="min-h-32 w-full resize-y rounded-md border border-line bg-ink p-3 text-sm outline-none focus:border-accent" />
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {suggestions.slice(0, 4).map((item) => <button key={item} onClick={() => setQuestion(item)} className="badge hover:border-accent">{item}</button>)}
          </div>
          <button disabled={loading || !question.trim()} onClick={analyze} className="flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-ink disabled:opacity-50"><Send size={16} /> {loading ? "Analyzing" : "Analyze with Ollama"}</button>
        </div>
      </Card>
      {error ? <Card className="border-bad/40 text-sm text-bad">{error}</Card> : null}
      {result ? (
        <div className="space-y-4">
          <Card>
            <h2 className="mb-2 font-semibold">Summary</h2>
            <p className="text-sm leading-6 text-slate-300">{result.summary}</p>
            <p className="mt-2 text-xs text-muted">Confidence: {Math.round(result.confidence * 100)}%</p>
          </Card>
          <div className="grid gap-4">
            {result.findings.map((finding) => (
              <Card key={finding.title}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold">{finding.title}</h3>
                  <Badge tone={finding.severity === "high" ? "bad" : finding.severity === "medium" ? "warn" : "good"}>{finding.severity}</Badge>
                </div>
                <p className="text-sm text-muted">Evidence: {finding.evidence}</p>
                {finding.evidenceEventIds.length ? <div className="mt-2 flex flex-wrap gap-2">{finding.evidenceEventIds.map((eventId) => <Link key={eventId} to={`/apps/${encodeURIComponent(appId)}/events?search=${encodeURIComponent(eventId)}`} className="badge hover:border-accent">{eventId.slice(0, 8)}</Link>)}</div> : null}
                <p className="mt-2 text-sm text-slate-300">Recommendation: {finding.recommendation}</p>
              </Card>
            ))}
          </div>
          <Card>
            <h2 className="mb-3 font-semibold">Suggested Follow-ups</h2>
            <div className="flex flex-wrap gap-2">{result.suggestedQueries.map((item) => <button key={item} onClick={() => setQuestion(item)} className="badge hover:border-accent">{item}</button>)}</div>
          </Card>
          {result.limitations.length ? <Card><h2 className="mb-2 font-semibold">Limitations</h2>{result.limitations.map((item) => <p key={item} className="text-sm text-muted">• {item}</p>)}</Card> : null}
        </div>
      ) : null}
      <Card>
        <h2 className="mb-3 flex items-center gap-2 font-semibold"><History size={16} /> Analysis history</h2>
        <div className="space-y-2">{(history.data?.runs ?? []).slice(0, 10).map((run) => <button key={run.id} onClick={() => { setQuestion(run.question); setResult(run.response); }} className="block w-full rounded bg-ink p-3 text-left text-sm"><span className="font-medium">{run.question}</span><span className="ml-2 text-xs text-muted">{run.model} · {new Date(run.createdAt).toLocaleString()}</span></button>)}{!history.data?.runs.length ? <p className="text-sm text-muted">No saved analyses yet.</p> : null}</div>
      </Card>
    </div>
  );
}
