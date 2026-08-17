import { createHmac } from "node:crypto";
import type { AlertIncident, AlertRule } from "@react-intelligence/shared";
import type { ServerConfig } from "../config.js";
import { createWebhookDelivery, finishWebhookDelivery, pendingWebhookJobs } from "../db/eventsRepository.js";

let deliveryRunning = false;

export function validateWebhookUrl(value: string, config: ServerConfig) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && config.deploymentMode === "self-hosted")) {
    return "Webhook URL must use HTTPS";
  }
  if (url.username || url.password) return "Webhook URL must not contain credentials";
  if (!config.webhookAllowedHosts.includes(url.hostname.toLowerCase())) {
    return `Webhook host ${url.hostname} is not present in RI_WEBHOOK_ALLOWED_HOSTS`;
  }
  return undefined;
}

export function queueAlertWebhooks(
  notifications: Array<{ incident: AlertIncident; rule: AlertRule; event: "opened" | "resolved" }>,
  config: ServerConfig
) {
  for (const notification of notifications) {
    if (!notification.rule.webhookUrl) continue;
    createWebhookDelivery(notification.incident.id, notification.incident.appId, notification.event);
  }
  void deliverPendingWebhooks(config);
}

export async function deliverPendingWebhooks(config: ServerConfig) {
  if (deliveryRunning) return;
  deliveryRunning = true;
  try {
  for (const job of pendingWebhookJobs()) {
    const payload = JSON.stringify({
      type: `alert.${job.event}`,
      deliveryId: job.id,
      incident: {
        id: job.incidentId,
        appId: job.appId,
        rule: job.ruleName,
        status: job.incidentStatus,
        value: job.value,
        threshold: job.threshold
      },
      occurredAt: new Date().toISOString()
    });
    const signature = createHmac("sha256", config.webhookSigningSecret).update(payload).digest("hex");
    const attempt = job.attempts + 1;
    try {
      const response = await fetch(job.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-react-intelligence-event": `alert.${job.event}`,
          "x-react-intelligence-signature": `sha256=${signature}`,
          "x-react-intelligence-delivery": job.id
        },
        body: payload,
        redirect: "error",
        signal: AbortSignal.timeout(5000)
      });
      finishWebhookDelivery(job.id, response.ok
        ? { status: "delivered", attempts: attempt, responseStatus: response.status }
        : { status: "failed", attempts: attempt, responseStatus: response.status, lastError: `HTTP ${response.status}` });
    } catch (error) {
      finishWebhookDelivery(job.id, { status: "failed", attempts: attempt, lastError: error instanceof Error ? error.message : "Webhook delivery failed" });
    }
  }
  } finally {
    deliveryRunning = false;
  }
}
