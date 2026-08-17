import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const destination = mkdtempSync(join(tmpdir(), "react-intelligence-sdk-pack-"));
try {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const output = execFileSync(executable, ["--filter", "@react-intelligence/sdk", "pack", "--pack-destination", destination, "--json"], { encoding: "utf8" });
  const manifest = JSON.parse(output);
  const files = manifest.files.map((entry) => entry.path);
  const unexpected = files.filter((path) => path !== "package.json" && !path.startsWith("dist/"));
  if (unexpected.length) throw new Error(`SDK package contains source-only files: ${unexpected.join(", ")}`);
  for (const required of ["dist/index.js", "dist/index.d.ts", "package.json"]) {
    if (!files.includes(required)) throw new Error(`SDK package is missing ${required}`);
  }
  console.log(`Verified ${manifest.filename} (${files.length} files).`);
} finally {
  rmSync(destination, { recursive: true, force: true });
}
