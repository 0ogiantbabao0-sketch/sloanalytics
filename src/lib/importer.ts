import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { validDate, normalizeMachine } from "./calendar";
import { one } from "./db";
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
const safeUrl = z
  .url()
  .refine(
    (s) => ["https:", "http:"].includes(new URL(s).protocol),
    "HTTP(S) URLが必要です",
  );
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
  })
  .refine(
    (r) => r.positive_units === null || r.positive_units <= r.units,
    "プラス台数が対象台数を超えています",
  );
export const CSV_HEADER =
  "data_kind,hall_id,hall_name,address,lat,lng,machine_name,date,units,total_diff,positive_units,games,source_name,source_url,permission";
export function importCsv(
  db: DatabaseSync,
  content: string,
  mode: "demo" | "real",
  sourceLabel = "CSV",
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
    if (Buffer.byteLength(content) > 2_000_000)
      throw new Error("CSVは2MB以下にしてください");
    const raw = parse(content, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      max_record_size: 10000,
    }) as unknown[];
    if (!raw.length || raw.length > 10000)
      throw new Error("1〜10,000行のCSVが必要です");
    const rows = raw.map((r, i) => {
      const parsed = rowSchema.safeParse(r);
      if (!parsed.success)
        throw new Error(
          `${i + 2}行目: ${parsed.error.issues.map((e) => e.message).join(" / ")}`,
        );
      return parsed.data;
    });
    const seen = new Set<string>();
    let changed = 0;
    db.exec("BEGIN IMMEDIATE");
    transaction = true;
    for (const row of rows) {
      if (row.data_kind !== mode)
        throw new Error("実データとデモデータを別の取込先にしてください");
      const alias = normalizeMachine(row.machine_name);
      const existing = one<{ machine_id: string }>(
        db,
        "SELECT machine_id FROM machine_aliases WHERE alias=?",
        alias,
      );
      const machineId =
        existing?.machine_id ??
        `m-${createHash("sha256").update(alias).digest("hex").slice(0, 16)}`;
      const key = `${row.hall_id}/${machineId}/${row.date}`;
      if (seen.has(key))
        throw new Error(`同じCSV内で日付・店舗・機種が重複しています: ${key}`);
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
        (oldHall.name !== row.hall_name ||
          oldHall.address !== row.address ||
          oldHall.lat !== row.lat ||
          oldHall.lng !== row.lng)
      )
        throw new Error(
          `${row.hall_id}: 店舗基本情報が既存データと異なります。IDを確認してください`,
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
      db.prepare("INSERT OR IGNORE INTO machine_aliases VALUES(?,?)").run(
        alias,
        machineId,
      );
      const sourceId = `s-${createHash("sha256").update(`${row.source_name}|${row.source_url}|${row.permission}`).digest("hex").slice(0, 16)}`;
      db.prepare(
        "INSERT INTO data_sources(id,name,url,method,permission,reliability,definition,retrieved_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET retrieved_at=excluded.retrieved_at",
      ).run(
        sourceId,
        row.source_name,
        row.source_url,
        "csv",
        row.permission,
        "提供者申告・未監査",
        "差枚=払出−投入、games=1台平均ゲーム数、positive_units=差枚>0の台数",
        now,
      );
      const before = one<Record<string, unknown>>(
        db,
        "SELECT * FROM daily_machine_results WHERE hall_id=? AND machine_id=? AND date=?",
        row.hall_id,
        machineId,
        row.date,
      );
      const after = {
        hall_id: row.hall_id,
        machine_id: machineId,
        date: row.date,
        total_diff: row.total_diff,
        units: row.units,
        positive_units: row.positive_units,
        games: row.games,
        source_id: sourceId,
      };
      if (!before || Object.entries(after).some(([k, v]) => before[k] !== v)) {
        db.prepare(
          "INSERT INTO daily_machine_results VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(hall_id,machine_id,date) DO UPDATE SET total_diff=excluded.total_diff,units=excluded.units,positive_units=excluded.positive_units,games=excluded.games,source_id=excluded.source_id,updated_at=excluded.updated_at",
        ).run(
          row.hall_id,
          machineId,
          row.date,
          row.total_diff,
          row.units,
          row.positive_units,
          row.games,
          sourceId,
          now,
        );
        db.prepare(
          "INSERT INTO data_revisions(job_id,entity,entity_key,before_json,after_json,changed_at) VALUES(?,?,?,?,?,?)",
        ).run(
          jobId,
          "daily_machine_results",
          key,
          before ? JSON.stringify(before) : null,
          JSON.stringify(after),
          now,
        );
        changed++;
      }
      // Observed unit count is valid only on its observed date; never invent future installations.
      db.prepare(
        "INSERT INTO hall_machine_installations VALUES(?,?,?,?,?) ON CONFLICT(hall_id,machine_id,valid_from) DO UPDATE SET units=excluded.units",
      ).run(row.hall_id, machineId, row.date, row.date, row.units);
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
