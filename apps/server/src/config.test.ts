import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "./config.js";

test("cloud mode rejects development credentials", () => {
  assert.throws(() => loadConfig({
    RI_DEPLOYMENT_MODE: "cloud",
    RI_DASHBOARD_TOKEN: "strong-dashboard-token-123456",
    RI_WEBHOOK_SIGNING_SECRET: "strong-webhook-secret-123456789012",
    RI_PROJECTS_JSON: JSON.stringify({ app: { writeKey: "ri_dev_app" } })
  }), /non-development.*keys/);
});

test("cloud mode never permits disabled authentication", () => {
  assert.throws(() => loadConfig({ RI_DEPLOYMENT_MODE: "cloud", RI_AUTH_DISABLED: "true" }), /cannot be used in cloud mode/);
});

test("public bind rejects development credentials and wildcard CORS", () => {
  assert.throws(() => loadConfig({ HOST: "0.0.0.0" }), /RI_DASHBOARD_TOKEN/);
  assert.throws(() => loadConfig({
    HOST: "0.0.0.0",
    RI_DASHBOARD_TOKEN: "ri_read_123456789012345678901234",
    RI_PROJECTS_JSON: JSON.stringify({ app: { writeKey: "ri_write_123456789012345678901234" } }),
    RI_ALLOWED_ORIGINS: "*"
  }), /cannot contain/);
});

test("public self-hosted configuration accepts generated-style credentials", () => {
  const config = loadConfig({
    HOST: "0.0.0.0",
    RI_DASHBOARD_TOKEN: "ri_read_123456789012345678901234",
    RI_PROJECTS_JSON: JSON.stringify({ app: { writeKey: "ri_write_123456789012345678901234" } }),
    RI_ALLOWED_ORIGINS: "https://intelligence.example.com",
    RI_WEBHOOK_ALLOWED_HOSTS: "hooks.example.com",
    RI_WEBHOOK_SIGNING_SECRET: "ri_webhook_12345678901234567890123456789012"
  });
  assert.equal(config.host, "0.0.0.0");
});

test("self-hosted mode binds to loopback by default", () => {
  const config = loadConfig({});
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.deploymentMode, "self-hosted");
});
