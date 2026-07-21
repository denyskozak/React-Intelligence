import cors from "@fastify/cors";
import {
  analyzeRequestSchema,
  batchEventsRequestSchema
} from "@react-intelligence/shared";
import Fastify from "fastify";
import { getAppOverview, getRecentEvents, groupedErrors, listApps, listEvents, overview, recordAnalysis, saveEvents } from "./db/eventsRepository.js";
import { analyzeWithOllama } from "./services/ollamaService.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true }));

app.post("/api/events/batch", async (request, reply) => {
  const parsed = batchEventsRequestSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid event batch", details: parsed.error.flatten() });
  saveEvents(parsed.data.events);
  return { accepted: parsed.data.events.length };
});

app.get("/api/apps", async () => overview());

app.get("/api/apps/:appId/overview", async (request) => {
  const { appId } = request.params as { appId: string };
  return getAppOverview(appId);
});

app.get("/api/apps/:appId/events", async (request) => {
  const { appId } = request.params as { appId: string };
  const query = request.query as Record<string, string | undefined>;
  return { events: listEvents(appId, query) };
});

app.get("/api/apps/:appId/errors", async (request) => {
  const { appId } = request.params as { appId: string };
  return { groups: groupedErrors(appId), events: listEvents(appId, { type: "error", limit: 200 }) };
});

app.get("/api/apps/:appId/performance", async (request) => {
  const { appId } = request.params as { appId: string };
  const data = getAppOverview(appId);
  return {
    p95ReactRenderDuration: data.p95ReactRenderDuration,
    slowestReactCommits: data.slowestReactCommits,
    slowestRoutes: data.slowestRoutes,
    webVitals: listEvents(appId, { type: "performance", limit: 100 })
  };
});

app.get("/api/apps/:appId/network", async (request) => {
  const { appId } = request.params as { appId: string };
  const data = getAppOverview(appId);
  return {
    averageFetchDuration: data.averageFetchDuration,
    p95FetchDuration: data.p95FetchDuration,
    networkFailures: data.networkFailures,
    events: listEvents(appId, { type: "network", limit: 300 })
  };
});

app.post("/api/apps/:appId/analyze", async (request, reply) => {
  const { appId } = request.params as { appId: string };
  const parsed = analyzeRequestSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid analysis request", details: parsed.error.flatten() });
  const events = getRecentEvents(appId, 500);
  try {
    const analysis = await analyzeWithOllama({ appId, events, ...parsed.data });
    recordAnalysis(appId, parsed.data.question, parsed.data.model, parsed.data.timeRange, analysis);
    return analysis;
  } catch (error) {
    request.log.error(error);
    return reply.status(502).send({
      error: "Ollama analysis failed",
      message: error instanceof Error ? error.message : "Unknown error",
      hint: "Make sure Ollama is running locally and the selected model is pulled."
    });
  }
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";
await app.listen({ port, host });
