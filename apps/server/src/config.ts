export type DeploymentMode = "self-hosted" | "cloud";

export interface ProjectCredential {
  writeKey: string;
  name?: string;
}

const developmentProjects: Record<string, ProjectCredential> = {
  "demo-app": { writeKey: "ri_dev_demo", name: "Demo App" },
  "test-store": { writeKey: "ri_dev_test", name: "Test Store" }
};

export interface ServerConfig {
  deploymentMode: DeploymentMode;
  authDisabled: boolean;
  dashboardToken: string;
  readTokens: Record<string, string[]>;
  projects: Record<string, ProjectCredential>;
  allowedOrigins: string[];
  webhookAllowedHosts: string[];
  webhookSigningSecret: string;
  port: number;
  host: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const deploymentMode = env.RI_DEPLOYMENT_MODE === "cloud" ? "cloud" : "self-hosted";
  const authDisabled = env.RI_AUTH_DISABLED === "true";
  const projects = parseJson<Record<string, ProjectCredential>>(env.RI_PROJECTS_JSON, developmentProjects, "RI_PROJECTS_JSON");
  const dashboardToken = env.RI_DASHBOARD_TOKEN ?? "ri_dev_dashboard";
  const readTokens = parseJson<Record<string, string[]>>(env.RI_READ_TOKENS_JSON, {}, "RI_READ_TOKENS_JSON");
  const allowedOrigins = (env.RI_ALLOWED_ORIGINS ?? "http://localhost:5178,http://127.0.0.1:5178,http://localhost:5179,http://127.0.0.1:5179,http://localhost:5180,http://127.0.0.1:5180")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const webhookAllowedHosts = (env.RI_WEBHOOK_ALLOWED_HOSTS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  const webhookSigningSecret = env.RI_WEBHOOK_SIGNING_SECRET ?? "ri_dev_webhook_secret";
  const port = Number(env.PORT ?? 4000);
  const host = env.HOST ?? "127.0.0.1";

  validateConfig({ deploymentMode, authDisabled, projects, dashboardToken, readTokens, allowedOrigins, webhookAllowedHosts, webhookSigningSecret, port, host });

  return {
    deploymentMode, authDisabled, dashboardToken, readTokens, projects, allowedOrigins,
    webhookAllowedHosts, webhookSigningSecret, port, host
  };
}

function validateConfig(config: ServerConfig) {
  const publiclyBound = !["127.0.0.1", "localhost", "::1"].includes(config.host);
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) throw new Error("PORT must be an integer between 1 and 65535");
  if (config.deploymentMode === "cloud" && config.authDisabled) throw new Error("RI_AUTH_DISABLED cannot be used in cloud mode");
  if (publiclyBound && config.authDisabled) throw new Error("RI_AUTH_DISABLED requires a loopback HOST");
  if ((publiclyBound || config.deploymentMode === "cloud") && isWeakSecret(config.dashboardToken)) {
    throw new Error("RI_DASHBOARD_TOKEN must be a long non-development secret for a public deployment");
  }
  if ((publiclyBound || config.deploymentMode === "cloud") && Object.values(config.projects).some((project) => isWeakSecret(project.writeKey))) {
    throw new Error("RI_PROJECTS_JSON must use long non-development write keys for a public deployment");
  }
  if ((publiclyBound || config.deploymentMode === "cloud") && config.allowedOrigins.some((origin) => origin === "*")) {
    throw new Error("RI_ALLOWED_ORIGINS cannot contain * for a public deployment");
  }
  if (config.webhookAllowedHosts.length && isWeakSecret(config.webhookSigningSecret, 32)) {
    throw new Error("RI_WEBHOOK_SIGNING_SECRET must contain at least 32 non-development characters when webhooks are enabled");
  }
  for (const [appId, project] of Object.entries(config.projects)) {
    if (!project || typeof project.writeKey !== "string" || !project.writeKey) throw new Error(`Project ${appId} must define a writeKey`);
  }
  for (const [token, appIds] of Object.entries(config.readTokens)) {
    if (!token || !Array.isArray(appIds) || appIds.some((appId) => typeof appId !== "string")) throw new Error("RI_READ_TOKENS_JSON must map tokens to project ID arrays");
  }
}

function isWeakSecret(value: string, minimumLength = 24) {
  return value.length < minimumLength || value.startsWith("ri_dev_") || value.startsWith("replace-with");
}

function parseJson<T>(value: string | undefined, fallback: T, name: string): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${name} must contain valid JSON`);
  }
}
