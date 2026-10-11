import type { DatabaseSync } from "node:sqlite";

export function migrateSources(db: DatabaseSync) {
  const version = (
    db.prepare("PRAGMA user_version").get() as { user_version: number }
  ).user_version;
  if (version > 3) throw new Error("未対応のDBバージョンです");
  if (version >= 2) return;
  try {
    db.exec("BEGIN IMMEDIATE");
    // Another process may have migrated while this connection waited for the write lock.
    const lockedVersion = (
      db.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    if (lockedVersion > 3) throw new Error("未対応のDBバージョンです");
    if (lockedVersion >= 2) {
      db.exec("COMMIT");
      return;
    }
    db.exec(`CREATE TABLE source_identity_mappings (
      provider_id TEXT NOT NULL, entity TEXT NOT NULL CHECK(entity IN ('hall','machine')),
      alias TEXT NOT NULL, canonical_id TEXT NOT NULL, evidence TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(provider_id,entity,alias)
    );
    CREATE TABLE source_observations (
      id INTEGER PRIMARY KEY, hall_id TEXT NOT NULL REFERENCES halls(id),
      machine_id TEXT NOT NULL REFERENCES machines(id), date TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES data_sources(id), provider_id TEXT NOT NULL,
      method TEXT NOT NULL, definition_code TEXT NOT NULL, definition TEXT NOT NULL,
      retrieved_at TEXT NOT NULL, imported_at TEXT NOT NULL, published_at TEXT,
      source_updated_at TEXT, raw_hall_name TEXT NOT NULL, raw_machine_name TEXT NOT NULL,
      payload_json TEXT NOT NULL, job_id INTEGER NOT NULL REFERENCES import_jobs(id),
      UNIQUE(hall_id,machine_id,date,source_id)
    );
    CREATE INDEX source_observations_result ON source_observations(hall_id,machine_id,date);
    CREATE TABLE observation_revisions (
      id INTEGER PRIMARY KEY, observation_id INTEGER NOT NULL REFERENCES source_observations(id),
      job_id INTEGER NOT NULL REFERENCES import_jobs(id), before_json TEXT, after_json TEXT NOT NULL,
      changed_at TEXT NOT NULL
    );
    PRAGMA user_version=2;
    COMMIT;`);
  } catch (e) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw e;
  }
}
