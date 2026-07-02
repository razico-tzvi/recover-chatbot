import Database from "better-sqlite3";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";

mkdirSync(dirname(config.DATABASE_PATH), { recursive: true });

/** Shared SQLite handle. Schema is created on first open (idempotent). */
export const db: Database.Database = new Database(config.DATABASE_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS stores (
    store_hash   TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    scope        TEXT,
    installed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS store_settings (
    store_hash       TEXT PRIMARY KEY,
    greeting         TEXT,
    title            TEXT,
    color            TEXT,
    system_extra     TEXT,
    escalation_email TEXT,
    slack_webhook    TEXT
  );
`);

// Best-effort: restrict the DB file to the owner (encrypted tokens live here).
try {
  chmodSync(config.DATABASE_PATH, 0o600);
} catch {
  /* non-fatal (e.g. unsupported FS) */
}
