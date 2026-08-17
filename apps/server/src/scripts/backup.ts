import Database from "better-sqlite3";
import { mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { configuredDbPath } from "../db/path.js";

const source = configuredDbPath;
const defaultName = `backups/react-intelligence-${new Date().toISOString().replaceAll(":", "-")}.sqlite`;
const destination = resolve(process.argv[2] ?? defaultName);

try {
  await stat(destination);
  throw new Error(`Backup destination already exists: ${destination}`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

await mkdir(dirname(destination), { recursive: true });
const database = new Database(source, { readonly: true, fileMustExist: true });
try {
  const result = database.pragma("quick_check") as Array<{ quick_check: string }>;
  if (result[0]?.quick_check !== "ok") throw new Error("Source database failed SQLite quick_check");
  await database.backup(destination);
  console.log(`Backup created: ${destination}`);
} finally {
  database.close();
}
