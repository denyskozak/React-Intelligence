import { randomBytes } from "node:crypto";
import { access, writeFile } from "node:fs/promises";

try {
  await access(".env");
  console.log(".env already exists; leaving it unchanged.");
} catch {
  const dashboardToken = `ri_read_${randomBytes(24).toString("hex")}`;
  const demoWriteKey = `ri_write_${randomBytes(24).toString("hex")}`;
  const testWriteKey = `ri_write_${randomBytes(24).toString("hex")}`;
  const webhookSigningSecret = `ri_webhook_${randomBytes(32).toString("hex")}`;
  const projects = JSON.stringify({
    "demo-app": { writeKey: demoWriteKey, name: "Demo App" },
    "test-store": { writeKey: testWriteKey, name: "Test Store" }
  });
  await writeFile(".env", [
    "RI_DEPLOYMENT_MODE=self-hosted",
    `RI_DASHBOARD_TOKEN=${dashboardToken}`,
    `RI_PROJECTS_JSON=${projects}`,
    "RI_READ_TOKENS_JSON={}",
    "RI_ALLOWED_ORIGINS=http://localhost:5178",
    "RI_WEBHOOK_ALLOWED_HOSTS=",
    `RI_WEBHOOK_SIGNING_SECRET=${webhookSigningSecret}`,
    "REACT_INTELLIGENCE_DB=data/react-intelligence.sqlite",
    "HOST=127.0.0.1",
    "PORT=4000",
    "VITE_API_URL=http://localhost:4000",
    ""
  ].join("\n"), { mode: 0o600 });
  console.log("Created .env with random local credentials.");
  if (!process.env.CI) {
    console.log(`Dashboard owner token: ${dashboardToken}`);
    console.log(`Demo write key: ${demoWriteKey}`);
    console.log(`Test Store write key: ${testWriteKey}`);
  }
}
