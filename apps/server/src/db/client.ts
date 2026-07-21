import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const dbPath = resolve(process.env.REACT_INTELLIGENCE_DB ?? "data/react-intelligence.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS apps (
    appId TEXT PRIMARY KEY,
    name TEXT,
    createdAt TEXT NOT NULL,
    lastSeen TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT NOT NULL,
    appId TEXT NOT NULL,
    userId TEXT,
    environment TEXT,
    release TEXT,
    startedAt TEXT NOT NULL,
    lastSeen TEXT NOT NULL,
    PRIMARY KEY (id, appId)
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    appId TEXT NOT NULL,
    sessionId TEXT NOT NULL,
    userId TEXT,
    type TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    route TEXT,
    environment TEXT,
    release TEXT,
    payload TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analysis_runs (
    id TEXT PRIMARY KEY,
    appId TEXT NOT NULL,
    question TEXT NOT NULL,
    model TEXT NOT NULL,
    timeRange TEXT NOT NULL,
    response TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_app_time ON events(appId, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_events_app_type ON events(appId, type);
  CREATE INDEX IF NOT EXISTS idx_events_app_route ON events(appId, route);
`);
