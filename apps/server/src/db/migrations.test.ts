import Database from "better-sqlite3";
import assert from "node:assert/strict";
import test from "node:test";
import { runMigrations } from "./migrations.js";

test("numbered migrations are idempotent", () => {
  const database = new Database(":memory:");
  try {
    runMigrations(database);
    runMigrations(database);
    const versions = database.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>;
    assert.deepEqual(versions.map((row) => row.version), [1, 2, 3, 4, 5]);
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    assert.ok(tables.some((table) => table.name === "audit_log"));
    assert.ok(tables.some((table) => table.name === "project_keys"));
    assert.ok(tables.some((table) => table.name === "error_issues"));
    const indexes = database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>;
    assert.ok(indexes.some((index) => index.name === "idx_events_app_time_id"));
  } finally {
    database.close();
  }
});
