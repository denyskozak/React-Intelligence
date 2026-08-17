import type { IntelligenceEvent } from "@react-intelligence/shared";
import type { ReactIntelligenceOptions } from "./types";

type Cleanup = () => void;
type RuntimeOptions = ReactIntelligenceOptions & {
  captureConsole: boolean;
  captureNetwork: boolean;
  captureUserActions: boolean;
  capturePerformance: boolean;
  sampleRate: number;
  scrubText: boolean;
  maxQueueSize: number;
  flushIntervalMs: number;
  persistOfflineEvents: boolean;
  processingMode: "local" | "remote";
};

const SDK_VERSION = "0.2.0";
const SCHEMA_VERSION = 1;
const MAX_BATCH_BYTES = 512_000;
const MAX_EVENT_BYTES = 64_000;
const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|credit|card|cvv|email|phone|address|session|api[-_]?key/i;
const REDACTED = "[REDACTED]";
const DEFAULTS = {
  captureConsole: false,
  captureNetwork: true,
  captureUserActions: true,
  capturePerformance: true,
  sampleRate: 1,
  scrubText: true,
  maxQueueSize: 1000,
  flushIntervalMs: 5000,
  persistOfflineEvents: true,
  processingMode: "remote" as const
};
const OFFLINE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let options: RuntimeOptions | undefined;
let sessionId = getOrCreateSessionId();
let navigationId = randomId();
let sequence = 0;
let queue: IntelligenceEvent[] = [];
let flushTimer: number | undefined;
let retryCount = 0;
let retryTimer: number | undefined;
let flushPromise: Promise<void> | undefined;
let deliveryBlocked = false;
let cleanups: Cleanup[] = [];
let configured = false;
let originalFetch: typeof window.fetch | undefined;

export function configureReactIntelligence(input: ReactIntelligenceOptions) {
  persistQueue();
  cleanupReactIntelligence(false);
  queue = [];
  options = { ...DEFAULTS, ...input };
  deliveryBlocked = false;
  configured = Math.random() <= clamp(options.sampleRate, 0, 1);
  if (!configured || typeof window === "undefined") return;

  queue = loadPersistedQueue();
  flushTimer = window.setInterval(() => void flush(), clamp(options.flushIntervalMs, 1000, 60_000));
  cleanups.push(() => flushTimer !== undefined && window.clearInterval(flushTimer));
  cleanups.push(listen(window, "error", onWindowError));
  cleanups.push(listen(window, "unhandledrejection", onUnhandledRejection));
  cleanups.push(listen(document, "visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush(true);
  }));
  cleanups.push(listen(window, "pagehide", () => void flush(true)));
  cleanups.push(listen(window, "online", () => void flush()));
  installRouteTracking();
  if (options.captureNetwork) installFetchWrapper();
  if (options.captureConsole) installConsoleCapture();
  if (options.captureUserActions) installUserActionCapture();
  if (options.capturePerformance) installPerformanceCapture();
}

export function cleanupReactIntelligence(flushPending = true) {
  if (flushPending) void flush(true); else persistQueue();
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];
  if (retryTimer !== undefined && typeof window !== "undefined") window.clearTimeout(retryTimer);
  retryTimer = undefined;
  if (originalFetch && typeof window !== "undefined") {
    window.fetch = originalFetch;
    originalFetch = undefined;
  }
  configured = false;
}

export function track(name: string, properties: Record<string, unknown> = {}) {
  enqueue("custom", { name: name.slice(0, 128), properties });
}

export function captureReactError(error: unknown, info?: { componentStack?: string }) {
  enqueue("react_error", {
    message: getErrorMessage(error),
    stack: error instanceof Error ? error.stack : undefined,
    componentStack: info?.componentStack
  });
}

export function captureProfilerCommit(payload: Record<string, unknown>) {
  enqueue("react_profiler", payload);
}

export function flushReactIntelligence() {
  return flush();
}

function enqueue(type: IntelligenceEvent["type"], payload: Record<string, unknown>, route = getRoute()) {
  if (!configured || !options) return;
  const safePayload = sanitize(payload) as Record<string, unknown>;
  safePayload.navigationId ??= navigationId;
  safePayload.processingMode ??= options.processingMode;
  const event: IntelligenceEvent = {
    id: randomId(),
    appId: options.appId,
    sessionId,
    userId: options.userId,
    type,
    timestamp: new Date().toISOString(),
    route: route.slice(0, 2048),
    environment: options.environment,
    release: options.release,
    schemaVersion: SCHEMA_VERSION,
    sdkVersion: SDK_VERSION,
    sequence: sequence++,
    payload: safePayload
  };
  queue.push(boundEventSize(event));
  if (queue.length > options.maxQueueSize) queue.splice(0, queue.length - options.maxQueueSize);
  persistQueue();
  if (queue.length >= 50) void flush();
}

function flush(usePageExitTransport = false) {
  if (!queue.length || !configured || !options || deliveryBlocked || typeof window === "undefined") return;
  if (flushPromise) return flushPromise;
  flushPromise = flushOnce(usePageExitTransport).finally(() => { flushPromise = undefined; });
  return flushPromise;
}

async function flushOnce(usePageExitTransport: boolean) {
  if (!options) return;
  if (navigator.onLine === false) {
    persistQueue();
    return;
  }
  const events = takeBatch();
  let body: string;
  try {
    body = JSON.stringify({ events });
  } catch {
    restoreEvents(events);
    return;
  }

  const url = `${options.endpoint.replace(/\/$/, "")}/api/events/batch`;
  try {
    if (usePageExitTransport && !options.writeKey && navigator.sendBeacon) {
      const accepted = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      if (accepted) {
        retryCount = 0;
        persistQueue();
        return;
      }
    }

    const transport = originalFetch ?? window.fetch;
    const response = await transport(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.writeKey ? { authorization: `Bearer ${options.writeKey}` } : {})
      },
      body,
      keepalive: usePageExitTransport
    });
    if (!response.ok) {
      if ([400, 401, 403, 404, 413].includes(response.status)) {
        restoreEvents(events);
        deliveryBlocked = true;
        persistQueue();
        return;
      }
      if (response.status === 429) {
        restoreEvents(events);
        persistQueue();
        scheduleRetry(retryAfterMs(response.headers.get("retry-after")));
        return;
      }
      throw new Error(`React Intelligence flush failed: ${response.status}`);
    }
    retryCount = 0;
    if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    retryTimer = undefined;
    persistQueue();
    if (queue.length) window.setTimeout(() => void flush(), 0);
  } catch {
    restoreEvents(events);
    persistQueue();
    scheduleRetry();
  }
}

function restoreEvents(events: IntelligenceEvent[]) {
  if (!options) return;
  queue = events.concat(queue).slice(-options.maxQueueSize);
}

function takeBatch() {
  const events: IntelligenceEvent[] = [];
  let bytes = 13;
  while (queue.length && events.length < 100) {
    const candidate = queue[0];
    const candidateBytes = serializedBytes(candidate) + (events.length ? 1 : 0);
    if (events.length && bytes + candidateBytes > MAX_BATCH_BYTES) break;
    events.push(queue.shift()!);
    bytes += candidateBytes;
  }
  return events;
}

function boundEventSize(event: IntelligenceEvent): IntelligenceEvent {
  if (serializedBytes(event) <= MAX_EVENT_BYTES) return event;
  return {
    ...event,
    payload: {
      name: event.type === "custom" ? String(event.payload.name ?? "oversized_custom_event").slice(0, 128) : undefined,
      telemetryTruncated: true,
      reason: "event_exceeded_64kb"
    }
  };
}

function serializedBytes(value: unknown) {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return MAX_EVENT_BYTES + 1; }
}

function queueStorageKey() {
  return options ? `react-intelligence-pending:${options.appId}` : undefined;
}

function persistQueue() {
  if (typeof window === "undefined" || !options?.persistOfflineEvents) return;
  const key = queueStorageKey();
  if (!key) return;
  try {
    if (queue.length) window.localStorage.setItem(key, JSON.stringify(queue));
    else window.localStorage.removeItem(key);
  } catch {
    // Storage can be disabled or full; delivery continues from the in-memory queue.
  }
}

function loadPersistedQueue(): IntelligenceEvent[] {
  if (!options?.persistOfflineEvents) return [];
  const key = queueStorageKey();
  if (!key) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const cutoff = Date.now() - OFFLINE_MAX_AGE_MS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("Invalid persisted queue");
    const restored = parsed.filter((event): event is IntelligenceEvent => {
      if (!event || typeof event !== "object") return false;
      const candidate = event as Partial<IntelligenceEvent>;
      return candidate.appId === options?.appId && typeof candidate.id === "string" &&
        typeof candidate.timestamp === "string" && Date.parse(candidate.timestamp) >= cutoff &&
        typeof candidate.payload === "object" && candidate.payload !== null;
    }).slice(-options.maxQueueSize);
    if (!restored.length) window.localStorage.removeItem(key);
    return restored;
  } catch {
    window.localStorage.removeItem(key);
    return [];
  }
}

function scheduleRetry(minimumDelayMs = 0) {
  if (typeof window === "undefined" || retryTimer !== undefined) return;
  const exponential = Math.min(30_000, 1000 * 2 ** retryCount++);
  const delay = Math.max(minimumDelayMs, Math.round(exponential * (0.75 + Math.random() * 0.5)));
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined;
    void flush();
  }, delay);
}

function retryAfterMs(value: string | null) {
  if (!value) return 60_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 24 * 60 * 60 * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(Math.max(0, date - Date.now()), 24 * 60 * 60 * 1000) : 60_000;
}

function onWindowError(event: Event) {
  const errorEvent = event as ErrorEvent;
  enqueue("error", {
    message: errorEvent.message,
    filename: scrubUrl(errorEvent.filename),
    lineno: errorEvent.lineno,
    colno: errorEvent.colno,
    stack: errorEvent.error?.stack,
    userAgent: navigator.userAgent
  });
}

function onUnhandledRejection(event: Event) {
  const rejection = event as PromiseRejectionEvent;
  enqueue("error", {
    message: getErrorMessage(rejection.reason),
    stack: rejection.reason instanceof Error ? rejection.reason.stack : undefined,
    unhandledRejection: true,
    userAgent: navigator.userAgent
  });
}

function installFetchWrapper() {
  originalFetch = window.fetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const startedAt = performance.now();
    const requestTimestamp = new Date().toISOString();
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    try {
      const response = await originalFetch!(input, init);
      enqueue("network", {
        url: scrubUrl(url), method, status: response.status,
        duration: Math.round(performance.now() - startedAt), success: response.ok,
        requestTimestamp, responseTimestamp: new Date().toISOString()
      });
      return response;
    } catch (error) {
      enqueue("network", {
        url: scrubUrl(url), method, duration: Math.round(performance.now() - startedAt),
        success: false, error: getErrorMessage(error), requestTimestamp,
        responseTimestamp: new Date().toISOString()
      });
      throw error;
    }
  };
}

function installConsoleCapture() {
  (["error", "warn"] as const).forEach((level) => {
    const original = console[level];
    console[level] = (...args: unknown[]) => {
      enqueue("console", {
        level,
        message: args.map((arg) => typeof arg === "string" ? arg : safeJson(arg)).join(" "),
        stack: new Error().stack
      });
      original.apply(console, args);
    };
    cleanups.push(() => { console[level] = original; });
  });
}

function installUserActionCapture() {
  cleanups.push(listen(document, "click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target : undefined;
    if (!target) return;
    enqueue("user_action", {
      action: "click",
      actionId: randomId(),
      tagName: target.tagName,
      textContent: options?.scrubText ? undefined : (target.textContent ?? "").trim().slice(0, 80),
      role: target.getAttribute("role"),
      ariaLabel: options?.scrubText ? undefined : target.getAttribute("aria-label"),
      testId: target.getAttribute("data-testid")
    });
  }, true));
  ["submit", "input", "change"].forEach((action) => {
    cleanups.push(listen(document, action, (event) => {
      const target = event.target instanceof HTMLElement ? event.target : undefined;
      enqueue("user_action", {
        action, actionId: randomId(), tagName: target?.tagName,
        role: target?.getAttribute("role"), testId: target?.getAttribute("data-testid")
      });
    }, true));
  });
}

function installRouteTracking() {
  let currentRoute = getRoute();
  const emit = () => {
    const nextRoute = getRoute();
    if (nextRoute !== currentRoute) {
      const previousRoute = currentRoute;
      currentRoute = nextRoute;
      navigationId = randomId();
      enqueue("route_change", { from: previousRoute, to: nextRoute }, nextRoute);
    }
  };
  const wrap = (name: "pushState" | "replaceState") => {
    const original = history[name];
    history[name] = function patchedHistory(this: History, ...args: Parameters<History[typeof name]>) {
      const result = original.apply(this, args);
      window.setTimeout(emit, 0);
      return result;
    };
    cleanups.push(() => { history[name] = original; });
  };
  wrap("pushState");
  wrap("replaceState");
  cleanups.push(listen(window, "popstate", emit));
}

function installPerformanceCapture() {
  const timer = window.setTimeout(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav) enqueue("performance", {
      kind: "navigation",
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
      load: Math.round(nav.loadEventEnd - nav.startTime),
      firstByte: Math.round(nav.responseStart - nav.requestStart)
    });
    performance.getEntriesByType("resource").slice(-50).forEach((resource) => enqueue("performance", {
      kind: "resource", name: scrubUrl(resource.name), duration: Math.round(resource.duration),
      initiatorType: (resource as PerformanceResourceTiming).initiatorType
    }));
  }, 1000);
  cleanups.push(() => window.clearTimeout(timer));

  if ("PerformanceObserver" in window) {
    try {
      const observer = new PerformanceObserver((list) => list.getEntries().forEach((entry) => enqueue("performance", {
        kind: entry.entryType, name: entry.name, duration: Math.round(entry.duration)
      })));
      observer.observe({ entryTypes: ["longtask", "largest-contentful-paint", "layout-shift", "first-input"] });
      cleanups.push(() => observer.disconnect());
    } catch {
      // Browser support varies; telemetry must never break the host app.
    }
  }
}

function sanitize(value: unknown, key = "", depth = 0, seen = new WeakSet<object>()): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value.slice(0, 2000);
  if (typeof value === "function" || typeof value === "symbol") return String(value);
  if (depth >= 5) return "[MAX_DEPTH]";
  if (typeof value === "object") {
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    if (value instanceof Error) return sanitize({ name: value.name, message: value.message, stack: value.stack }, key, depth + 1, seen);
    if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, key, depth + 1, seen));
    return Object.fromEntries(Object.entries(value).slice(0, 50).map(([childKey, child]) => [childKey, sanitize(child, childKey, depth + 1, seen)]));
  }
  return String(value);
}

function listen(target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, capture = false) {
  target.addEventListener(type, listener, capture);
  return () => target.removeEventListener(type, listener, capture);
}

function getRoute() {
  return typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.hash}`;
}

function getOrCreateSessionId() {
  if (typeof sessionStorage === "undefined") return randomId();
  const key = "react-intelligence-session";
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const next = randomId();
    sessionStorage.setItem(key, next);
    return next;
  } catch {
    return randomId();
  }
}

function randomId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000);
}

function safeJson(value: unknown) {
  try { return JSON.stringify(sanitize(value)); } catch { return "[UNSERIALIZABLE]"; }
}

function scrubUrl(value: string) {
  try {
    const url = new URL(value, typeof window === "undefined" ? "http://localhost" : window.location.href);
    url.search = "";
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return value.split("?")[0].slice(0, 2048);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
