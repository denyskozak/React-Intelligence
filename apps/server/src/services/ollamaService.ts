import type { AnalysisResponse, IntelligenceEvent } from "@react-intelligence/shared";

export async function analyzeWithOllama(input: {
  appId: string;
  question: string;
  model: string;
  timeRange: string;
  events: IntelligenceEvent[];
}): Promise<AnalysisResponse> {
  const diagnosticContext = compactEvents(input.events);
  const prompt = `
Ты анализируешь runtime telemetry React-приложения. Используй только предоставленные данные. Не выдумывай.
Сначала найди performance bottlenecks, затем errors, затем suspicious user flows, затем network issues.
Отвечай строго JSON без markdown в формате:
{"summary":"...","findings":[{"severity":"low|medium|high","title":"...","evidence":"...","recommendation":"..."}],"suggestedQueries":["..."]}

App: ${input.appId}
Time range: ${input.timeRange}
Question: ${input.question}
Telemetry:
${diagnosticContext}
`;

  const response = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: input.model, prompt, stream: false, format: "json" })
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
  const body = (await response.json()) as { response?: string };
  return parseAnalysis(body.response ?? "");
}

function compactEvents(events: IntelligenceEvent[]) {
  return JSON.stringify(
    events.slice(0, 300).map((event) => ({
      type: event.type,
      timestamp: event.timestamp,
      route: event.route,
      release: event.release,
      environment: event.environment,
      payload: event.payload
    })),
    null,
    2
  );
}

function parseAnalysis(text: string): AnalysisResponse {
  try {
    const parsed = JSON.parse(text) as AnalysisResponse;
    return {
      summary: parsed.summary ?? "No summary returned.",
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      suggestedQueries: Array.isArray(parsed.suggestedQueries) ? parsed.suggestedQueries : []
    };
  } catch {
    return {
      summary: text || "Ollama returned an empty response.",
      findings: [],
      suggestedQueries: ["Which routes are slowest?", "Find suspicious network failures."]
    };
  }
}
