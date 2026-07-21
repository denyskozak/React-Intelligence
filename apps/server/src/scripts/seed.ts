import type { IntelligenceEvent } from "@react-intelligence/shared";
import { saveEvents } from "../db/eventsRepository.js";

const appId = "demo-app";
const routes = ["/", "/checkout", "/products", "/account", "/pricing"];
const releases = ["1.0.0", "1.1.0"];
const now = Date.now();

function event(type: IntelligenceEvent["type"], route: string, payload: Record<string, unknown>, offsetMinutes: number): IntelligenceEvent {
  return {
    id: crypto.randomUUID(),
    appId,
    sessionId: `session-${Math.floor(Math.random() * 24)}`,
    type,
    timestamp: new Date(now - offsetMinutes * 60_000).toISOString(),
    route,
    environment: "development",
    release: releases[Math.floor(Math.random() * releases.length)],
    payload
  };
}

const events: IntelligenceEvent[] = [];
for (let i = 0; i < 260; i++) {
  const route = routes[Math.floor(Math.random() * routes.length)];
  events.push(event("route_change", route, { from: routes[Math.floor(Math.random() * routes.length)], to: route }, i * 7));
  events.push(event("react_profiler", route, {
    id: route === "/checkout" ? "CheckoutFlow" : "ReactApp",
    phase: Math.random() > 0.75 ? "mount" : "update",
    actualDuration: Math.round((route === "/checkout" ? 45 : 12) + Math.random() * 120),
    baseDuration: Math.round(20 + Math.random() * 80),
    startTime: Math.random() * 1000,
    commitTime: Math.random() * 1200
  }, i * 5));
  events.push(event("network", route, {
    url: route === "/checkout" ? "https://api.example.test/payments" : "https://api.example.test/catalog",
    method: "GET",
    status: route === "/checkout" && Math.random() > 0.72 ? 502 : 200,
    duration: Math.round((route === "/checkout" ? 500 : 120) + Math.random() * 900),
    success: !(route === "/checkout" && Math.random() > 0.72)
  }, i * 4));
  if (Math.random() > 0.8) {
    events.push(event("console", route, { level: "warn", message: route === "/checkout" ? "Payment retry threshold exceeded" : "Deprecated prop used" }, i * 3));
  }
  if (route === "/checkout" && Math.random() > 0.72) {
    events.push(event("react_error", route, {
      message: "Checkout totals failed to reconcile",
      stack: "Error: Checkout totals failed to reconcile\n    at CheckoutSummary.tsx:42",
      componentStack: "at CheckoutSummary\nat CheckoutFlow"
    }, i * 2));
  }
  if (Math.random() > 0.65) {
    events.push(event("user_action", route, {
      action: "click",
      tagName: "BUTTON",
      textContent: route === "/checkout" ? "Place order" : "View details",
      role: "button",
      testId: route.replace("/", "") || "home"
    }, i));
  }
}
events.push(event("custom", "/checkout", { name: "checkout_started", properties: { cartSize: 3, source: "product_page" } }, 10));

saveEvents(events);
console.log(`Seeded ${events.length} events for ${appId}`);
