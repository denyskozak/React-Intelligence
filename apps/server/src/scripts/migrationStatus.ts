import { db, dbPath } from "../db/client.js";

const migrations = db.prepare("SELECT version, name, appliedAt FROM schema_migrations ORDER BY version").all();
console.log(JSON.stringify({ database: dbPath, migrations }, null, 2));
db.close();
