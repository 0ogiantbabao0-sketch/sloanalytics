import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { validDate, normalizeMachine } from "./calendar";
import { one } from "./db";
import { mappedIdentity, normalizeHall, providerSchema } from "./identities";
import { DEFINITION_CODE, STANDARD_DEFINITION } from "./source-catalog";

const date = z.string().refine(validDate, "日付は実在する YYYY-MM-DD");
const number = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .pipe(z.coerce.number<string>().finite().min(min).max(max));
const integer = (min: number, max = 1e9) =>
  number(min, max).refine(Number.isInteger, "整数が必要です");
const optionalInt = z.union([z.literal("").transform(() => null), integer(0)]);
const timestamp = z.iso
  .datetime({ offset: true })
  .refine(
    (v) => Date.parse(v) <= Date.now() + 300000,
    "未来の取得・公開日時は指定できません",
  );
const optionalTimestamp = z.union([z.literal(""), timestamp]).optional();
const safeUrl = z.url().refine((s) => {
  const u = new URL(s);
  return (
    ["https:", "http:"].includes(u.protocol) &&
    !u.username &&
    !u.password &&
    !u.search &&
    !u.hash
  );
}, "認証情報・クエリ・フラグメントを含まない公開HTTP(S) URLが必要です");
const rowSchema = z
  .object({
    data_kind: z.enum(["demo", "real"]),
    hall_id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    hall_name: z.string().trim().min(1).max(160),
    address: z.string().trim().min(1).max(300),
    lat: number(-90, 90),
    lng: number(-180, 180),
    machine_name: z.string().trim().min(1).max(160),
    date,
    units: integer(1, 10000),
    total_diff: integer(-1e9),
    positive_units: optionalInt,
    games: optionalInt,
    source_name: z.string().trim().min(1).max(160),
    source_url: safeUrl,
    permission: z.string().trim().min(1).max(1000),
    provider_id: providerSchema.default("user"),
    definition_code: z.literal(DEFINITION_CODE).default(DEFINITION_CODE),
    definition: z.string().trim().min(1).max(1000).default(STANDARD_DEFINITION),
    retrieved_at: optionalTimestamp,
    published_at: optionalTimestamp,
    source_updated_at: optionalTimestamp,
  })
  .strict()
  .refine(
    (r) => r.positive_units === null || r.positive_units <= r.units,
    "プラス台数が対象台数を超えています",
  );
export const CSV_HEADER =
  "data_kind,hall_id,hall_name,address,lat,lng,machine_name,date,units,total_diff,positive_units,games,source_name,source_url,permission";
export const CSV_V2_HEADER = `${CSV_HEADER},provider_id,definition_code,definition,retrieved_at,published_at,source_updated_at`;
export type ImportContext = {
  method?: "csv" | "manual" | "licensed-csv";
  providerId?: string;
  permission?: string;
};
export type CanonicalResult = {
  hall_id: string;
  machine_id: string;
  date: string;
  total_diff: number;
  units: number;
  positive_units: number | null;
  games: number | null;
  source_id: string;
};

export function writeCanonical(
  db: DatabaseSync,
  after: CanonicalResult,
  jobId: number,
  now: string,
) {
  const before = one<Record<string, unknown>>(
    db,
    "SELECT * FROM daily_machine_results WHERE hall_id=? AND machine_id=? AND date=?",
    after.hall_id,
    after.machine_id,
    after.date,
  );
  if (before && Object.entries(after).every(([k, v]) => before[k] === v))
    return false;
  db.prepare(
    "INSERT INTO daily_machine_results VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(hall_id,machine_id,date) DO UPDATE SET total_diff=excluded.total_diff,units=excluded.units,positive_units=excluded.positive_units,games=excluded.games,source_id=excluded.source_id,updated_at=excluded.updated_at",
  ).run(
    after.hall_id,
    after.machine_id,
    after.date,
    after.total_diff,
    after.units,
    after.positive_units,
    after.games,
    after.source_id,
    now,
  );
  db.prepare(
    "INSERT INTO data_revisions(job_id,entity,entity_key,before_json,after_json,changed_at) VALUES(?,?,?,?,?,?)",
  ).run(
    jobId,
    "daily_machine_results",
    `${after.hall_id}/${after.machine_id}/${after.date}`,
    before ? JSON.stringify(before) : null,
    JSON.stringify(after),
    now,
  );
  db.prepare(
    "INSERT INTO hall_machine_installations VALUES(?,?,?,?,?) ON CONFLICT(hall_id,machine_id,valid_from) DO UPDATE SET units=excluded.units",
  ).run(after.hall_id, after.machine_id, after.date, after.date, after.units);
  return true;
}

export function importCsv(
  db: DatabaseSync,
  content: string,
  mode: "demo" | "real",
  sourceLabel = "CSV",
  context: ImportContext = {},
) {
  return importData(
    db,
    () => {
      if (Buffer.byteLength(content) > 2_000_000)
        throw new Error("CSVは2MB以下にしてください");
      return parse(content, {
        columns: (headers: string[]) => {
          if (new Set(headers).size !== headers.length)
            throw new Error("CSVヘッダーが重複しています");
          return headers;
        },
        skip_empty_lines: true,
        bom: true,
        max_record_size: 10000,
      }) as unknown[];
    },
    mode,
    sourceLabel,
    context,
  );
}

export function importRecords(
  db: DatabaseSync,
  rows: unknown[],
  mode: "demo" | "real",
) {
  return importData(db, () => rows, mode, "手動登録", { method: "manual" });
}

function importData(
  db: DatabaseSync,
  read: () => unknown[],
  mode: "demo" | "real",
  sourceLabel: string,
  context: ImportContext,
) {
  const now = new Date().toISOString();
  const jobId = Number(
    db
      .prepare(
        "INSERT INTO import_jobs(started_at,status,source) VALUES(?,?,?)",
      )
      .run(now, "running", sourceLabel).lastInsertRowid,
  );
  let transaction = false;
  try {
    const raw = read();
    if (!Array.isArray(raw) || !raw.length || raw.length > 10000)
      throw new Error("1〜10,000行のデータが必要です");
    const rows = raw.map((r, i) => {
      const parsed = rowSchema.safeParse(r);
      if (!parsed.success)
        throw new Error(
          `${i + 1}件目: ${parsed.error.issues.map((e) => e.message).join(" / ")}`,
        );
      if (context.providerId && parsed.data.provider_id !== context.providerId)
        throw new Error("契約した取得元とCSVのprovider_idが一致しません");
      return parsed.data;
    });
    let changed = 0,
      observations = 0,
      retained = 0;
    const seen = new Set<string>();
    db.exec("BEGIN IMMEDIATE");
    transaction = true;
    for (const row of rows) {
      if (row.data_kind !== mode)
        throw new Error("実データとデモデータを別の取込先にしてください");
      const alias = normalizeMachine(row.machine_name);
      if (!alias) throw new Error("有効な機種名が必要です");
      const existing = one<{ machine_id: string }>(
        db,
        "SELECT machine_id FROM machine_aliases WHERE alias=?",
        alias,
      );
      const machineId =
        mappedIdentity(db, row.provider_id, "machine", row.machine_name) ??
        existing?.machine_id ??
        `m-${createHash("sha256").update(alias).digest("hex").slice(0, 16)}`;
      const hallMapping = mappedIdentity(
        db,
        row.provider_id,
        "hall",
        row.hall_name,
      );
      if (hallMapping && hallMapping !== row.hall_id)
        throw new Error("店舗IDと登録済みの名寄せが一致しません");
      const key = `${row.hall_id}/${machineId}/${row.date}`;
      if (seen.has(key))
        throw new Error(`同じ取込内で日付・店舗・機種が重複しています: ${key}`);
      seen.add(key);
      const oldHall = one<{
        name: string;
        address: string;
        lat: number;
        lng: number;
      }>(
        db,
        "SELECT h.name,l.address,l.lat,l.lng FROM halls h JOIN hall_locations l ON l.hall_id=h.id WHERE h.id=?",
        row.hall_id,
      );
      if (
        oldHall &&
        ((normalizeHall(oldHall.name) !== normalizeHall(row.hall_name) &&
          hallMapping !== row.hall_id) ||
          normalizeHall(oldHall.address) !== normalizeHall(row.address) ||
          oldHall.lat !== row.lat ||
          oldHall.lng !== row.lng)
      )
        throw new Error(
          `${row.hall_id}: 店舗基本情報が既存データと異なります。ID・住所を確認し、別名は名寄せに登録してください`,
        );
      db.prepare("INSERT OR IGNORE INTO halls(id,name) VALUES(?,?)").run(
        row.hall_id,
        row.hall_name,
      );
      db.prepare("INSERT OR IGNORE INTO hall_locations VALUES(?,?,?,?)").run(
        row.hall_id,
        row.address,
        row.lat,
        row.lng,
      );
      db.prepare("INSERT OR IGNORE INTO machines(id,name) VALUES(?,?)").run(
        machineId,
        row.machine_name,
      );
      // A provider-specific alias must never leak into another provider's global dictionary.
      if (!mappedIdentity(db, row.provider_id, "machine", row.machine_name))
        db.prepare("INSERT OR IGNORE INTO machine_aliases VALUES(?,?)").run(
          alias,
          machineId,
        );
      const method = context.method ?? "csv";
      const permission = context.permission ?? row.permission;
      const legacySource =
        row.provider_id === "user" &&
        method === "csv" &&
        row.definition === STANDARD_DEFINITION;
      const sourceId = legacySource
        ? `s-${createHash("sha256").update(`${row.source_name}|${row.source_url}|${permission}`).digest("hex").slice(0, 16)}`
        : `s-${createHash("sha256")
            .update(
              JSON.stringify([
                row.provider_id,
                row.source_name,
                row.source_url,
                permission,
                row.definition_code,
                row.definition,
                method,
              ]),
            )
            .digest("hex")
            .slice(0, 24)}`;
      const retrievedAt = row.retrieved_at || now;
      db.prepare(
        "INSERT INTO data_sources(id,name,url,method,permission,reliability,definition,retrieved_at,published_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET retrieved_at=CASE WHEN julianday(excluded.retrieved_at)>julianday(data_sources.retrieved_at) THEN excluded.retrieved_at ELSE data_sources.retrieved_at END",
      ).run(
        sourceId,
        row.source_name,
        row.source_url,
        method,
        permission,
        "提供者申告・未監査",
        row.definition,
        retrievedAt,
        row.published_at || null,
      );
      const after: CanonicalResult = {
        hall_id: row.hall_id,
        machine_id: machineId,
        date: row.date,
        total_diff: row.total_diff,
        units: row.units,
        positive_units: row.positive_units,
        games: row.games,
        source_id: sourceId,
      };
      const prior = one<{ id: number; payload_json: string }>(
        db,
        "SELECT * FROM source_observations WHERE hall_id=? AND machine_id=? AND date=? AND source_id=?",
        row.hall_id,
        machineId,
        row.date,
        sourceId,
      );
      const payload = JSON.stringify(after);
      const observation = db
        .prepare(
          `INSERT INTO source_observations(hall_id,machine_id,date,source_id,provider_id,method,definition_code,definition,retrieved_at,imported_at,published_at,source_updated_at,raw_hall_name,raw_machine_name,payload_json,job_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(hall_id,machine_id,date,source_id) DO UPDATE SET retrieved_at=excluded.retrieved_at,imported_at=excluded.imported_at,published_at=excluded.published_at,source_updated_at=excluded.source_updated_at,raw_hall_name=excluded.raw_hall_name,raw_machine_name=excluded.raw_machine_name,payload_json=excluded.payload_json,job_id=excluded.job_id RETURNING id`,
        )
        .get(
          row.hall_id,
          machineId,
          row.date,
          sourceId,
          row.provider_id,
          method,
          row.definition_code,
          row.definition,
          retrievedAt,
          now,
          row.published_at || null,
          row.source_updated_at || null,
          row.hall_name,
          row.machine_name,
          payload,
          jobId,
        ) as { id: number };
      // Immutable acquisition receipts preserve timestamps, original names and values on every import.
      const saved = db
        .prepare("SELECT * FROM source_observations WHERE id=?")
        .get(observation.id);
      db.prepare(
        "INSERT INTO observation_revisions(observation_id,job_id,before_json,after_json,changed_at) VALUES(?,?,?,?,?)",
      ).run(
        observation.id,
        jobId,
        prior ? JSON.stringify(prior) : null,
        JSON.stringify(saved),
        now,
      );
      if (!prior || prior.payload_json !== payload) observations++;
      const selected = one<{ source_id: string }>(
        db,
        "SELECT source_id FROM daily_machine_results WHERE hall_id=? AND machine_id=? AND date=?",
        row.hall_id,
        machineId,
        row.date,
      );
      if (!selected || selected.source_id === sourceId) {
        if (writeCanonical(db, after, jobId, now)) changed++;
      } else retained++;
    }
    db.prepare(
      "UPDATE import_jobs SET status=?,finished_at=?,row_count=? WHERE id=?",
    ).run("success", new Date().toISOString(), rows.length, jobId);
    db.exec("COMMIT");
    transaction = false;
    return {
      jobId,
      rows: rows.length,
      changed,
      unchanged: rows.length - changed,
      observations,
      retained,
    };
  } catch (e) {
    if (transaction) db.exec("ROLLBACK");
    const message = e instanceof Error ? e.message : "取込失敗";
    db.prepare(
      "UPDATE import_jobs SET status=?,finished_at=?,error=? WHERE id=?",
    ).run("failed", new Date().toISOString(), message.slice(0, 2000), jobId);
    throw new Error(message);
  }
}

export function selectObservation(db: DatabaseSync, id: number) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const observation = one<{ payload_json: string }>(
      db,
      "SELECT payload_json FROM source_observations WHERE id=?",
      id,
    );
    if (!observation) throw new Error("対象の出典レコードがありません");
    const now = new Date().toISOString();
    const jobId = Number(
      db
        .prepare(
          "INSERT INTO import_jobs(started_at,status,source) VALUES(?,?,?)",
        )
        .run(now, "running", "採用出典の変更").lastInsertRowid,
    );
    const changed = writeCanonical(
      db,
      JSON.parse(observation.payload_json) as CanonicalResult,
      jobId,
      now,
    );
    db.prepare(
      "UPDATE import_jobs SET status='success',finished_at=?,row_count=1 WHERE id=?",
    ).run(now, jobId);
    db.exec("COMMIT");
    return { changed };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
