import type Database from "better-sqlite3";

interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "initial telemetry schema",
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS apps (
        appId TEXT PRIMARY KEY, name TEXT, createdAt TEXT NOT NULL, lastSeen TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT NOT NULL, appId TEXT NOT NULL, userId TEXT, environment TEXT, release TEXT,
        startedAt TEXT NOT NULL, lastSeen TEXT NOT NULL, PRIMARY KEY (id, appId)
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, appId TEXT NOT NULL, sessionId TEXT NOT NULL, userId TEXT,
        type TEXT NOT NULL, timestamp TEXT NOT NULL, route TEXT, environment TEXT, release TEXT,
        payload TEXT NOT NULL, createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analysis_runs (
        id TEXT PRIMARY KEY, appId TEXT NOT NULL, question TEXT NOT NULL, model TEXT NOT NULL,
        timeRange TEXT NOT NULL, response TEXT NOT NULL, createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_maps (
        id TEXT PRIMARY KEY, appId TEXT NOT NULL, release TEXT NOT NULL, bundleName TEXT NOT NULL,
        map TEXT NOT NULL, createdAt TEXT NOT NULL, UNIQUE(appId, release, bundleName)
      );
      CREATE TABLE IF NOT EXISTS alert_rules (
        id TEXT PRIMARY KEY, appId TEXT NOT NULL, name TEXT NOT NULL, metric TEXT NOT NULL,
        threshold REAL NOT NULL, timeRange TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS alert_incidents (
        id TEXT PRIMARY KEY, ruleId TEXT NOT NULL, appId TEXT NOT NULL, value REAL NOT NULL,
        threshold REAL NOT NULL, status TEXT NOT NULL, triggeredAt TEXT NOT NULL, resolvedAt TEXT,
        FOREIGN KEY(ruleId) REFERENCES alert_rules(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_events_app_time ON events(appId, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_events_app_type ON events(appId, type);
      CREATE INDEX IF NOT EXISTS idx_events_app_route ON events(appId, route);
      CREATE INDEX IF NOT EXISTS idx_source_maps_lookup ON source_maps(appId, release, bundleName);
      CREATE INDEX IF NOT EXISTS idx_alert_rules_app ON alert_rules(appId);
      CREATE INDEX IF NOT EXISTS idx_alert_incidents_app ON alert_incidents(appId, triggeredAt DESC);
    `)
  },
  {
    version: 2,
    name: "event metadata and project lifecycle",
    up: (db) => {
      addColumnIfMissing(db, "apps", "writeKeyHash", "TEXT");
      addColumnIfMissing(db, "apps", "retentionDays", "INTEGER NOT NULL DEFAULT 30");
      addColumnIfMissing(db, "events", "schemaVersion", "INTEGER NOT NULL DEFAULT 1");
      addColumnIfMissing(db, "events", "sdkVersion", "TEXT");
      addColumnIfMissing(db, "events", "sequence", "INTEGER");
      addColumnIfMissing(db, "events", "serverReceivedAt", "TEXT");
    }
  },
  {
    version: 3,
    name: "rbac quotas webhooks and audit",
    up: (db) => {
      addColumnIfMissing(db, "apps", "monthlyEventQuota", "INTEGER NOT NULL DEFAULT 100000");
      addColumnIfMissing(db, "alert_rules", "webhookUrl", "TEXT");
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_keys (
          id TEXT PRIMARY KEY, appId TEXT NOT NULL, name TEXT NOT NULL, prefix TEXT NOT NULL,
          keyHash TEXT NOT NULL UNIQUE, createdAt TEXT NOT NULL, lastUsedAt TEXT, revokedAt TEXT,
          FOREIGN KEY(appId) REFERENCES apps(appId) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS access_tokens (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, tokenHash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL,
          role TEXT NOT NULL, appIds TEXT NOT NULL, createdAt TEXT NOT NULL, lastUsedAt TEXT, revokedAt TEXT
        );
        CREATE TABLE IF NOT EXISTS ingestion_daily (
          appId TEXT NOT NULL, day TEXT NOT NULL, acceptedEvents INTEGER NOT NULL DEFAULT 0,
          rejectedEvents INTEGER NOT NULL DEFAULT 0, acceptedBytes INTEGER NOT NULL DEFAULT 0,
          rejectedBytes INTEGER NOT NULL DEFAULT 0, lastAcceptedAt TEXT, lastRejectedAt TEXT,
          PRIMARY KEY(appId, day), FOREIGN KEY(appId) REFERENCES apps(appId) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY, actor TEXT NOT NULL, role TEXT NOT NULL, action TEXT NOT NULL,
          appId TEXT, metadata TEXT NOT NULL, createdAt TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS webhook_deliveries (
          id TEXT PRIMARY KEY, incidentId TEXT NOT NULL, appId TEXT NOT NULL, event TEXT NOT NULL,
          status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, responseStatus INTEGER,
          lastError TEXT, createdAt TEXT NOT NULL, deliveredAt TEXT,
          FOREIGN KEY(incidentId) REFERENCES alert_incidents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_project_keys_app ON project_keys(appId, createdAt DESC);
        CREATE INDEX IF NOT EXISTS idx_access_tokens_active ON access_tokens(tokenHash, revokedAt);
        CREATE INDEX IF NOT EXISTS idx_ingestion_daily_app ON ingestion_daily(appId, day DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(createdAt DESC);
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_incident ON webhook_deliveries(incidentId, createdAt DESC);
      `);
    }
  },
  {
    version: 4,
    name: "idempotent ingestion and error issues",
    up: (db) => {
      addColumnIfMissing(db, "events", "errorFingerprint", "TEXT");
      addColumnIfMissing(db, "ingestion_daily", "duplicateEvents", "INTEGER NOT NULL DEFAULT 0");
      db.exec(`
        CREATE TABLE IF NOT EXISTS error_issues (
          id TEXT PRIMARY KEY, appId TEXT NOT NULL, fingerprint TEXT NOT NULL, title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open', firstSeen TEXT NOT NULL, lastSeen TEXT NOT NULL,
          eventCount INTEGER NOT NULL DEFAULT 1, lastEventId TEXT NOT NULL, routes TEXT NOT NULL,
          releases TEXT NOT NULL, stack TEXT, componentStack TEXT, resolvedAt TEXT, resolvedBy TEXT,
          UNIQUE(appId, fingerprint), FOREIGN KEY(appId) REFERENCES apps(appId) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_events_error_fingerprint ON events(appId, errorFingerprint, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_error_issues_app_status ON error_issues(appId, status, lastSeen DESC);
      `);
    }
  },
  {
    version: 5,
    name: "scalable event query indexes",
    up: (db) => db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_app_time_id ON events(appId, timestamp DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_events_app_release_time ON events(appId, release, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_events_app_environment_time ON events(appId, environment, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_events_app_session_time ON events(appId, sessionId, timestamp DESC);
    `)
  }
];

export function runMigrations(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, appliedAt TEXT NOT NULL
  )`);
  const applied = new Set((db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map((row) => row.version));
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations (version, name, appliedAt) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, new Date().toISOString());
    })();
  }
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((candidate) => candidate.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
