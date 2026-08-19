import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const destination = mkdtempSync(join(tmpdir(), "react-intelligence-server-deploy-"));
const serverDirectory = join(destination, "server");
const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
let child;
try {
  execFileSync(executable, ["--filter", "@react-intelligence/server", "deploy", "--prod", serverDirectory], {
    stdio: "ignore",
    env: { ...process.env, CI: "true" }
  });
  const deployedTests = readdirSync(join(serverDirectory, "dist"), { recursive: true })
    .filter((path) => String(path).endsWith(".test.js"));
  if (deployedTests.length) throw new Error(`Production deploy contains test files: ${deployedTests.join(", ")}`);
  child = execFile(process.execPath, [join(serverDirectory, "dist/index.js")], {
    cwd: serverDirectory,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "49639",
      REACT_INTELLIGENCE_DB: join(destination, "runtime.sqlite")
    }
  });
  await waitForReady("http://127.0.0.1:49639/ready");
  const ready = await fetch("http://127.0.0.1:49639/ready").then((response) => response.json());
  if (!ready.ready || ready.database !== "ok") throw new Error(`Unexpected readiness response: ${JSON.stringify(ready)}`);
  console.log(`Verified deployed server runtime with schema v${ready.schemaVersion}.`);
} finally {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  }
  rmSync(destination, { recursive: true, force: true });
}

async function waitForReady(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* Server has not bound yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Deployed server did not become ready within 10 seconds");
}
