import { Bot, Send } from "lucide-react";
import { useState } from "react";
import { Badge, Card, SelectBox } from "../components/ui";
import { api } from "../lib/api";

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

  async function analyze() {
    setLoading(true);
    setError("");
    try {
      setResult(await api.analyze(appId, { question, model, timeRange: "24h" }));
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
        <p className="mt-1 text-sm text-muted">Ask local Ollama to reason over collected telemetry.</p>
      </div>
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted"><Bot size={16} /> Ollama model</div>
          <SelectBox value={model} onValueChange={setModel} items={["llama3.1", "llama3", "mistral", "codellama"]} />
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
          </Card>
          <div className="grid gap-4">
            {result.findings.map((finding) => (
              <Card key={finding.title}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold">{finding.title}</h3>
                  <Badge tone={finding.severity === "high" ? "bad" : finding.severity === "medium" ? "warn" : "good"}>{finding.severity}</Badge>
                </div>
                <p className="text-sm text-muted">Evidence: {finding.evidence}</p>
                <p className="mt-2 text-sm text-slate-300">Recommendation: {finding.recommendation}</p>
              </Card>
            ))}
          </div>
          <Card>
            <h2 className="mb-3 font-semibold">Suggested Follow-ups</h2>
            <div className="flex flex-wrap gap-2">{result.suggestedQueries.map((item) => <button key={item} onClick={() => setQuestion(item)} className="badge hover:border-accent">{item}</button>)}</div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
