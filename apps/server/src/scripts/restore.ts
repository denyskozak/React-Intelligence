import Database from "better-sqlite3";
import { copyFile, mkdir, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { configuredDbPath } from "../db/path.js";

const sourceArgument = process.argv[2];
if (!sourceArgument) throw new Error("Usage: pnpm --filter @react-intelligence/server db:restore <backup.sqlite>");

const source = resolve(sourceArgument);
const target = configuredDbPath;
await stat(source);
if (source === target) throw new Error("Backup source and target database must differ");

const backup = new Database(source, { readonly: true, fileMustExist: true });
try {
  const check = backup.pragma("quick_check") as Array<{ quick_check: string }>;
  if (check[0]?.quick_check !== "ok") throw new Error("Backup failed SQLite quick_check");
  const migrations = backup.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number | null };
  if (!migrations.version) throw new Error("Backup has no schema migration history");
} finally {
  backup.close();
}

await mkdir(dirname(target), { recursive: true });
try {
  await stat(target);
  const safetyCopy = `${target}.before-restore-${new Date().toISOString().replaceAll(":", "-")}`;
  const current = new Database(target, { readonly: true, fileMustExist: true });
  try { await current.backup(safetyCopy); } finally { current.close(); }
  console.log(`Current database preserved: ${safetyCopy}`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

await copyFile(source, target);
for (const suffix of ["-wal", "-shm"]) {
  try { await unlink(`${target}${suffix}`); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
console.log(`Database restored: ${target}`);
console.log("Restart the React Intelligence server before accepting traffic.");
