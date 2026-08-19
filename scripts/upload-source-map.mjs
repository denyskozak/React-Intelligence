import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const [appId, release, filePath] = process.argv.slice(2);
if (!appId || !release || !filePath) {
  console.error("Usage: pnpm upload:sourcemap <appId> <release> <path-to-map>");
  process.exit(1);
}

const endpoint = process.env.RI_ENDPOINT ?? "http://localhost:4000";
const writeKey = process.env.RI_WRITE_KEY;
if (!writeKey) {
  console.error("RI_WRITE_KEY is required");
  process.exit(1);
}

const map = await readFile(filePath, "utf8");
const response = await fetch(`${endpoint}/api/apps/${encodeURIComponent(appId)}/source-maps`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${writeKey}` },
  body: JSON.stringify({ release, bundleName: basename(filePath, ".map"), map })
});
if (!response.ok) throw new Error(`Upload failed (${response.status}): ${await response.text()}`);
console.log(await response.text());
