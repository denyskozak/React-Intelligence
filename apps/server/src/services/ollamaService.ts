import { analysisResponseSchema, type AnalysisResponse, type IntelligenceEvent } from "@react-intelligence/shared";

const responseFormat = {
  type: "object",
  required: ["summary", "findings", "confidence", "limitations", "suggestedQueries"],
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "title", "evidence", "evidenceEventIds", "affectedRoutes", "recommendation"],
        properties: {
          severity: { type: "string", enum: ["low", "medium", "high"] },
          title: { type: "string" },
          evidence: { type: "string" },
          evidenceEventIds: { type: "array", items: { type: "string" } },
          affectedRoutes: { type: "array", items: { type: "string" } },
          recommendation: { type: "string" }
        }
      }
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    limitations: { type: "array", items: { type: "string" } },
    suggestedQueries: { type: "array", items: { type: "string" } }
  }
};

export async function analyzeWithOllama(input: {
  appId: string;
  question: string;
  model: string;
  timeRange: string;
  events: IntelligenceEvent[];
}): Promise<AnalysisResponse> {
  const diagnosticContext = buildDiagnosticContext(input.events);
  const prompt = `
Ты анализируешь runtime telemetry React-приложения. Используй только предоставленные данные.
Каждый вывод обязан ссылаться на реальные event IDs из representativeEvents. Если данных недостаточно, укажи это в limitations и снизь confidence.
Сначала проверь errors, затем React render cost, network failures и suspicious user flows.

App: ${input.appId}
Time range: ${input.timeRange}
Question: ${input.question}
Telemetry context:
${JSON.stringify(diagnosticContext)}
`;

  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const response = await fetch(`${ollamaBaseUrl.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: input.model,
      prompt,
      stream: false,
      format: responseFormat,
      options: { temperature: 0 }
    }),
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
  const body = (await response.json()) as { response?: string };
  return parseAnalysis(body.response ?? "");
}

export async function getOllamaStatus() {
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  try {
    const response = await fetch(`${ollamaBaseUrl.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return { available: false, models: [], error: `Ollama returned ${response.status}` };
    const body = await response.json() as { models?: Array<{ name: string }> };
    return { available: true, models: (body.models ?? []).map((model) => model.name) };
  } catch (error) {
    return { available: false, models: [], error: error instanceof Error ? error.message : "Ollama unavailable" };
  }
}

function buildDiagnosticContext(events: IntelligenceEvent[]) {
  const countsByType: Record<string, number> = {};
  const countsByRoute: Record<string, number> = {};
  for (const event of events) {
    countsByType[event.type] = (countsByType[event.type] ?? 0) + 1;
    const route = event.route ?? "unknown";
    countsByRoute[route] = (countsByRoute[route] ?? 0) + 1;
  }
  const representativeEvents = events
    .slice()
    .sort((a, b) => relevance(b) - relevance(a) || b.timestamp.localeCompare(a.timestamp))
    .slice(0, 120)
    .map((event) => ({
      id: event.id,
      type: event.type,
      timestamp: event.timestamp,
      route: event.route,
      release: event.release,
      environment: event.environment,
      payload: event.payload
    }));
  return {
    totalEvents: events.length,
    countsByType,
    topRoutes: Object.entries(countsByRoute).sort((a, b) => b[1] - a[1]).slice(0, 15),
    representativeEvents
  };
}

function relevance(event: IntelligenceEvent) {
  if (event.type === "error" || event.type === "react_error") return 5;
  if (event.type === "network" && (event.payload.success === false || Number(event.payload.status ?? 0) >= 400)) return 4;
  if (event.type === "react_profiler") return 3;
  if (event.type === "performance") return 2;
  return 1;
}

function parseAnalysis(text: string): AnalysisResponse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Ollama returned invalid JSON");
  }
  const parsed = analysisResponseSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Ollama response failed validation: ${parsed.error.message}`);
  return parsed.data;
}
