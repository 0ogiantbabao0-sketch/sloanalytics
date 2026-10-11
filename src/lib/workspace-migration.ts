import type { DatabaseSync } from "node:sqlite";
import { sourceCandidates } from "./source-catalog";
export function migrateWorkspace(db: DatabaseSync) {
  if (
    (db.prepare("PRAGMA user_version").get() as { user_version: number })
      .user_version < 3
  ) {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (
        (db.prepare("PRAGMA user_version").get() as { user_version: number })
          .user_version < 3
      ) {
        db.exec(`CREATE TABLE daily_machine_results_v3 (
          hall_id TEXT REFERENCES halls(id), machine_id TEXT REFERENCES machines(id), date TEXT NOT NULL,
          total_diff INTEGER, units INTEGER NOT NULL CHECK(units>0), positive_units INTEGER CHECK(positive_units BETWEEN 0 AND units),
          games INTEGER CHECK(games>=0), source_id TEXT NOT NULL REFERENCES data_sources(id), updated_at TEXT NOT NULL,
          avg_diff REAL, CHECK(total_diff IS NOT NULL OR avg_diff IS NOT NULL), PRIMARY KEY(hall_id,machine_id,date));
          INSERT INTO daily_machine_results_v3(hall_id,machine_id,date,total_diff,units,positive_units,games,source_id,updated_at)
          SELECT hall_id,machine_id,date,total_diff,units,positive_units,games,source_id,updated_at FROM daily_machine_results;
          DROP TABLE daily_machine_results;
          ALTER TABLE daily_machine_results_v3 RENAME TO daily_machine_results;
          CREATE INDEX machine_results_date ON daily_machine_results(date,hall_id,machine_id);
          ALTER TABLE machines ADD COLUMN manufacturer TEXT;
          ALTER TABLE machines ADD COLUMN model TEXT;
          CREATE TABLE managed_sources(id TEXT PRIMARY KEY, config_json TEXT NOT NULL, updated_at TEXT NOT NULL);
          CREATE TABLE csv_mappings(source_id TEXT REFERENCES managed_sources(id), kind TEXT NOT NULL, signature TEXT NOT NULL,
            mapping_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(source_id,kind));
          CREATE TABLE import_files(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES managed_sources(id), kind TEXT NOT NULL,
            filename TEXT NOT NULL, path TEXT NOT NULL, sha256 TEXT NOT NULL, encoding TEXT NOT NULL, delimiter TEXT NOT NULL,
            headers_json TEXT NOT NULL, signature TEXT NOT NULL, status TEXT NOT NULL, row_count INTEGER NOT NULL DEFAULT 0,
            config_json TEXT, summary_json TEXT, created_at TEXT NOT NULL, finished_at TEXT, error TEXT);
          CREATE TABLE import_rows(file_id TEXT REFERENCES import_files(id), line INTEGER NOT NULL, raw_json TEXT NOT NULL,
            status TEXT, messages_json TEXT, normalized_json TEXT, PRIMARY KEY(file_id,line));
          CREATE INDEX import_rows_status ON import_rows(file_id,status,line);
          CREATE TABLE collected_records(id INTEGER PRIMARY KEY, source_id TEXT NOT NULL REFERENCES managed_sources(id),
            kind TEXT NOT NULL, record_key TEXT NOT NULL, payload_json TEXT NOT NULL, fingerprint TEXT NOT NULL,
            file_id TEXT NOT NULL REFERENCES import_files(id), line INTEGER NOT NULL, adopted INTEGER NOT NULL,
            reason TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(source_id,kind,record_key));
          CREATE INDEX collected_records_key ON collected_records(kind,record_key);
          CREATE TABLE collected_revisions(id INTEGER PRIMARY KEY, record_id INTEGER NOT NULL REFERENCES collected_records(id),
            file_id TEXT NOT NULL REFERENCES import_files(id), before_json TEXT, after_json TEXT NOT NULL, created_at TEXT NOT NULL);
          CREATE TABLE external_identities(source_id TEXT REFERENCES managed_sources(id), entity TEXT NOT NULL,
            external_id TEXT NOT NULL, canonical_id TEXT NOT NULL, PRIMARY KEY(source_id,entity,external_id));
          PRAGMA user_version=3;`);
      }
      db.exec("COMMIT");
    } catch (e) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw e;
    }
  }
  const initial = [
    ...sourceCandidates,
    {
      id: "dechau",
      name: "でちゃう！",
      url: "https://www.dechau.com/",
      category: "取材結果・台番別情報",
    },
  ];
  for (const s of initial)
    db.prepare("INSERT OR IGNORE INTO managed_sources VALUES(?,?,?)").run(
      s.id,
      JSON.stringify({
        ...s,
        method: "manual",
        enabled: true,
        priority: 100,
        storageAllowed: false,
        autoAllowed: false,
        permission: "",
        checkedAt: "",
        frequency: "未設定",
      }),
      new Date().toISOString(),
    );
}
