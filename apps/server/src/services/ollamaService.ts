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
You are React Intelligence, a strict runtime telemetry analyst for a React application.

Your job is to answer the user's question using ONLY the JSON telemetry context below.
Return ONLY valid JSON matching the requested schema. Do not use Markdown, code blocks, or conversational wrapper text.

GLOBAL RULES:
1. Answer strictly and exclusively the single question provided in input.question. Do not infer, assume, or address unasked questions.
2. Do not invent, infer, or guess causes that are not directly supported by telemetry.
3. Every finding must be backed by real event IDs copied verbatim from:
   - representativeEvents[].id
   - topComponentsByRenderCost[].eventId
4. Never truncate, synthesize, reformat, or shorten event IDs.
5. Use at most 3 evidenceEventIds per finding.
6. The evidence text must match the evidenceEventIds count and content.
7. The summary must be specific and must mention the key metric, route, component, or event type that supports the answer.
8. suggestedQueries must contain exactly 2 or 3 useful follow-up questions relevant *only* to the answered question.
9. Do not give generic web development advice. Do not mention CDN, node_modules, bundle size, scripts, stylesheets, routing optimizations, or code splitting unless those exact facts are directly present in an error or network event.

QUESTION ROUTING RULES:
- If the question asks about components, render cost, React profiler, slow renders, actualDuration, or baseDuration:
  * Use topComponentsByRenderCost as the primary source.
  * Use only react_profiler events as evidence.
  * Ignore performance, network, route_change, resource, navigation, console, and custom events.
  * actualDuration and baseDuration are milliseconds (ms), never seconds.
  * A good finding title is the component name.
  * Evidence should include component, route, phase, actualDuration ms, and baseDuration ms.
  * Evidence must be a human-readable sentence, not an array or tuple.
  * Round duration values to 2 decimal places.

- If the question asks about routes with errors:
  * Use only error and react_error events.
  * Group findings by route.
  * Evidence should include route, error message/type, and count when available.

- If the question asks about slowest network calls or failed network calls:
  * Use only network events.
  * Prefer events where success=false, status >= 400, or duration is high.
  * Group findings by route or URL.
  * Evidence should include URL/route, status, success, and duration if available.

- If the question asks about both errors and network:
  * Use only error, react_error, and network events.
  * Do not use react_profiler or performance events.

STRICT FALLBACK:
- If the relevant event type is missing, return:
  summary: "No reliable findings were found in the provided events for this query."
  findings: []
  confidence: 0.2
  limitations: include a short explanation of which event type was missing.
- If available events do not contain enough fields to answer, return no findings instead of guessing.

App ID: ${input.appId}
Time Range: ${input.timeRange}
Question: ${input.question}

Telemetry Context JSON:
${JSON.stringify(diagnosticContext)}
`;

  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 180_000);
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

    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
  const body = (await response.json()) as { response?: string };
  const analysis = parseAnalysis(body.response ?? "");
  return validateEvidenceEventIds(analysis, diagnosticContext);
}

function validateEvidenceEventIds(
    analysis: AnalysisResponse,
    diagnosticContext: ReturnType<typeof buildDiagnosticContext>
): AnalysisResponse {
  const allowedIds = new Set([
    ...diagnosticContext.representativeEvents.map((event) => event.id),
    ...diagnosticContext.topComponentsByRenderCost.map((event) => event.eventId)
  ]);

  const validFindings = analysis.findings.filter((finding) =>
      finding.evidenceEventIds.length > 0 &&
      finding.evidenceEventIds.every((id) => allowedIds.has(id))
  );

  const removedCount = analysis.findings.length - validFindings.length;

  if (!validFindings.length) {
    return {
      ...analysis,
      summary: "No reliable findings could be produced from the provided telemetry events.",
      findings: [],
      confidence: Math.min(analysis.confidence, 0.3),
      limitations: [
        ...analysis.limitations,
        "The model did not provide findings backed by valid event IDs."
      ]
    };
  }

  return {
    ...analysis,
    findings: validFindings.map((finding) => ({
      ...finding,
      evidenceEventIds: finding.evidenceEventIds.slice(0, 3)
    })),
    limitations: removedCount
        ? [...analysis.limitations, "Findings with unknown evidence event IDs were removed."]
        : analysis.limitations
  };
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
    .slice(0, 40)
    .map((event) => ({
      id: event.id,
      type: event.type,
      timestamp: event.timestamp,
      route: event.route,
      release: event.release,
      environment: event.environment,
      payload: event.payload
    }));

  const profilerEvents = events.filter((event) => event.type === "react_profiler");

  const topComponentsByRenderCost = profilerEvents
      .map((event) => ({
        eventId: event.id,
        component: event.payload.id,
        actualDuration: event.payload.actualDuration,
        baseDuration: event.payload.baseDuration,
        phase: event.payload.phase,
        route: event.route
      }))
      .sort((a, b) => Number(b.actualDuration ?? 0) - Number(a.actualDuration ?? 0))
      .slice(0, 10);
  return {
    totalEvents: events.length,
    countsByType,
    topRoutes: Object.entries(countsByRoute).sort((a, b) => b[1] - a[1]).slice(0, 15),
    representativeEvents,
    topComponentsByRenderCost
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
