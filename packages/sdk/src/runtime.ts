import type { IntelligenceEvent } from "@react-intelligence/shared";
import type { ReactIntelligenceOptions } from "./types";

type Cleanup = () => void;

const DEFAULTS = {
  captureConsole: true,
  captureNetwork: true,
  captureUserActions: true,
  capturePerformance: true,
  sampleRate: 1,
  scrubText: false
};

let options: Required<Omit<ReactIntelligenceOptions, "environment" | "release" | "userId">> &
  Pick<ReactIntelligenceOptions, "environment" | "release" | "userId">;
let sessionId = getOrCreateSessionId();
let queue: IntelligenceEvent[] = [];
let flushTimer: number | undefined;
let retryCount = 0;
let cleanups: Cleanup[] = [];
let configured = false;
let originalFetch: typeof window.fetch | undefined;

export function configureReactIntelligence(input: ReactIntelligenceOptions) {
  cleanupReactIntelligence();
  options = { ...DEFAULTS, ...input };
  configured = Math.random() <= Math.max(0, Math.min(1, options.sampleRate));
  if (!configured || typeof window === "undefined") return;

  flushTimer = window.setInterval(() => void flush(), 5000);
  cleanups.push(() => flushTimer && window.clearInterval(flushTimer));
  cleanups.push(listen(window, "error", onWindowError));
  cleanups.push(listen(window, "unhandledrejection", onUnhandledRejection));
  cleanups.push(listen(document, "visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush(true);
  }));
  cleanups.push(listen(window, "pagehide", () => void flush(true)));
  installRouteTracking();
  if (options.captureNetwork) installFetchWrapper();
  if (options.captureConsole) installConsoleCapture();
  if (options.captureUserActions) installUserActionCapture();
  if (options.capturePerformance) installPerformanceCapture();
}

export function cleanupReactIntelligence() {
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];
  if (originalFetch) {
    window.fetch = originalFetch;
    originalFetch = undefined;
  }
  configured = false;
}

export function track(name: string, properties: Record<string, unknown> = {}) {
  enqueue("custom", { name, properties });
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

function enqueue(type: IntelligenceEvent["type"], payload: Record<string, unknown>, route = getRoute()) {
  if (!configured || !options) return;
  queue.push({
    id: crypto.randomUUID(),
    appId: options.appId,
    sessionId,
    userId: options.userId,
    type,
    timestamp: new Date().toISOString(),
    route,
    environment: options.environment,
    release: options.release,
    payload
  });
  if (queue.length >= 50) void flush();
}

async function flush(useBeacon = false) {
  if (!queue.length || !configured || !options) return;
  const events = queue.splice(0, queue.length);
  const body = JSON.stringify({ events });
  const url = `${options.endpoint.replace(/\/$/, "")}/api/events/batch`;
  try {
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      retryCount = 0;
      return;
    }
    // Bypass the instrumented fetch wrapper so telemetry delivery never creates
    // more network telemetry (and therefore an infinite flush loop).
    const transport = originalFetch ?? window.fetch;
    const response = await transport(url, { method: "POST", headers: { "content-type": "application/json" }, body });
    if (!response.ok) throw new Error(`React Intelligence flush failed: ${response.status}`);
    retryCount = 0;
  } catch {
    queue = events.concat(queue).slice(0, 1000);
    const delay = Math.min(30000, 1000 * 2 ** retryCount++);
    window.setTimeout(() => void flush(), delay);
  }
}

function onWindowError(event: Event) {
  const errorEvent = event as ErrorEvent;
  enqueue("error", {
    message: errorEvent.message,
    filename: errorEvent.filename,
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
        url: scrubUrl(url),
        method,
        status: response.status,
        duration: Math.round(performance.now() - startedAt),
        success: response.ok,
        requestTimestamp,
        responseTimestamp: new Date().toISOString()
      });
      return response;
    } catch (error) {
      enqueue("network", {
        url: scrubUrl(url),
        method,
        duration: Math.round(performance.now() - startedAt),
        success: false,
        error: getErrorMessage(error),
        requestTimestamp,
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
        message: args.map((arg) => (typeof arg === "string" ? arg : safeJson(arg))).join(" "),
        stack: new Error().stack
      });
      original.apply(console, args);
    };
    cleanups.push(() => {
      console[level] = original;
    });
  });
}

function installUserActionCapture() {
  cleanups.push(listen(document, "click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target : undefined;
    if (!target) return;
    enqueue("user_action", {
      action: "click",
      tagName: target.tagName,
      textContent: options.scrubText ? undefined : (target.textContent ?? "").trim().slice(0, 80),
      role: target.getAttribute("role"),
      ariaLabel: target.getAttribute("aria-label"),
      testId: target.getAttribute("data-testid")
    });
  }, true));
  ["submit", "input", "change"].forEach((action) => {
    cleanups.push(listen(document, action, (event) => {
      const target = event.target instanceof HTMLElement ? event.target : undefined;
      enqueue("user_action", {
        action,
        tagName: target?.tagName,
        role: target?.getAttribute("role"),
        ariaLabel: target?.getAttribute("aria-label"),
        testId: target?.getAttribute("data-testid")
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
    cleanups.push(() => {
      history[name] = original;
    });
  };
  wrap("pushState");
  wrap("replaceState");
  cleanups.push(listen(window, "popstate", emit));
}

function installPerformanceCapture() {
  window.setTimeout(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav) {
      enqueue("performance", {
        kind: "navigation",
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
        load: Math.round(nav.loadEventEnd - nav.startTime),
        firstByte: Math.round(nav.responseStart - nav.requestStart)
      });
    }
    performance.getEntriesByType("resource").slice(-50).forEach((resource) => {
      enqueue("performance", {
        kind: "resource",
        name: scrubUrl(resource.name),
        duration: Math.round(resource.duration),
        initiatorType: (resource as PerformanceResourceTiming).initiatorType
      });
    });
  }, 1000);
  if ("PerformanceObserver" in window) {
    try {
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          enqueue("performance", { kind: entry.entryType, name: entry.name, duration: Math.round(entry.duration) });
        });
      });
      observer.observe({ entryTypes: ["longtask", "largest-contentful-paint", "layout-shift", "first-input"] });
      cleanups.push(() => observer.disconnect());
    } catch {
      // Browser support varies; telemetry must never break the host app.
    }
  }
}

function listen(target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, capture = false) {
  target.addEventListener(type, listener, capture);
  return () => target.removeEventListener(type, listener, capture);
}

function getRoute() {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

function getOrCreateSessionId() {
  if (typeof sessionStorage === "undefined") return crypto.randomUUID();
  const key = "react-intelligence-session";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const next = crypto.randomUUID();
  sessionStorage.setItem(key, next);
  return next;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function scrubUrl(value: string) {
  try {
    const url = new URL(value, window.location.href);
    url.search = "";
    return url.toString();
  } catch {
    return value.split("?")[0];
  }
}
