import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { fields, requiredGroups, type ImportKind } from "./csv-dictionary";
import { getFile } from "./csv-files";
import { requireSource, publicUrl } from "./managed-sources";
import { normalizeHall, mappedIdentity } from "./identities";
import { normalizeMachine, validDate, todayJST } from "./calendar";
import { writeCanonical } from "./importer";
export type Row = Record<string, string | number | null>;
export type PreviewConfig = {
  mapping: Record<string, string>;
  defaults: Record<string, string>;
  definition: string;
  confirmed: boolean;
  saveMapping: boolean;
};
const stable = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, stable(x)]),
        )
      : v;
export const fingerprint = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(stable(v)))
    .digest("hex");
const blank = (s: string) => /^(?:|不明|N\/A|NA|null|—|-)$/i.test(s.trim());
export function numeric(raw: string, percent = false): number | null {
  let s = raw.normalize("NFKC").trim();
  if (blank(s)) return null;
  s = s.replace(/[−–]/g, "-");
  if (percent) s = s.replace(/%$/, "");
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s))
    throw new Error(`数値形式を確認してください: ${raw}`);
  const n = Number(s.replaceAll(",", ""));
  if (!Number.isFinite(n) || Math.abs(n) > 1e12)
    throw new Error("数値が範囲外です");
  return n;
}
export function dateValue(raw: string): string | null {
  if (blank(raw)) return null;
  const m = raw
    .normalize("NFKC")
    .trim()
    .match(/^(\d{4})(?:-|\/|年)(\d{1,2})(?:-|\/|月)(\d{1,2})日?$/);
  if (!m) throw new Error(`日付形式を確認してください: ${raw}`);
  const date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  if (!validDate(date)) throw new Error(`実在しない日付: ${raw}`);
  return date;
}
const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
function required(v: unknown, label: string) {
  if (v === null || v === undefined || v === "")
    throw new Error(`${label}が必要です`);
}
function integer(v: unknown, label: string, min = 0, max = 1e9) {
  required(v, label);
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    throw new Error(`${label}が不正です`);
}
function identity(
  db: DatabaseSync,
  provider: string,
  entity: "hall" | "machine",
  r: Row,
  warnings: string[],
) {
  const name = String(r[`${entity}_name`] || ""),
    external = String(r[`${entity}_external_id`] || "");
  const externalMatch = external
    ? (
        db
          .prepare(
            "SELECT canonical_id FROM external_identities WHERE source_id=? AND entity=? AND external_id=?",
          )
          .get(provider, entity, external) as
          { canonical_id: string } | undefined
      )?.canonical_id
    : undefined;
  const alias = name ? mappedIdentity(db, provider, entity, name) : undefined;
  let id = String(r[`${entity}_id`] || externalMatch || alias || "");
  if (externalMatch && id !== externalMatch)
    throw new Error("要確認: 外部IDが別のマスタを指しています");
  if (alias && id !== alias)
    throw new Error("要確認: 別名の対応先と指定IDが一致しません");
  if (!id && name) {
    if (entity === "hall") {
      const found = (
        db.prepare("SELECT id,name FROM halls").all() as {
          id: string;
          name: string;
        }[]
      ).filter((h) => normalizeHall(h.name) === normalizeHall(name));
      if (found.length > 1)
        throw new Error(
          "要確認: 同名店舗が複数あります。店舗IDを指定してください",
        );
      id = found[0]?.id || "";
    } else {
      id =
        (
          db
            .prepare("SELECT machine_id FROM machine_aliases WHERE alias=?")
            .get(normalizeMachine(name)) as { machine_id: string } | undefined
        )?.machine_id || "";
    }
  }
  if (!id && entity === "machine" && name) {
    id = `m-${fingerprint([normalizeMachine(name), r.model || ""]).slice(0, 20)}`;
    warnings.push("新規機種を作成します。旧機種との違いを確認してください");
  }
  if (!id || !idPattern.test(id))
    throw new Error(
      `${entity === "hall" ? "店舗" : "機種"}を識別できません。マスタ登録・別名登録またはID指定が必要です`,
    );
  const table = entity === "hall" ? "halls" : "machines",
    existing = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as
      Row | undefined;
  if (!existing && entity === "hall")
    throw new Error("先にホール基本情報CSVを登録してください");
  if (!existing && !name) throw new Error("新しい機種の正式名が必要です");
  if (existing && name) {
    const norm = entity === "hall" ? normalizeHall : normalizeMachine;
    const globalMachine =
      entity === "machine"
        ? (
            db
              .prepare("SELECT machine_id FROM machine_aliases WHERE alias=?")
              .get(normalizeMachine(name)) as { machine_id: string } | undefined
          )?.machine_id
        : undefined;
    if (
      norm(String(existing.name)) !== norm(name) &&
      alias !== id &&
      globalMachine !== id &&
      externalMatch !== id
    )
      throw new Error("要確認: IDと名称が一致しません。別名を登録してください");
  }
  if (
    entity === "machine" &&
    existing?.model &&
    r.model &&
    existing.model !== r.model
  )
    throw new Error("要確認: 型式が異なるため統合できません");
  r[`${entity}_id`] = id;
  return id;
}
export function normalizeRow(
  db: DatabaseSync,
  provider: string,
  kind: ImportKind,
  raw: Record<string, string>,
  mode: "demo" | "real",
  definition: string,
) {
  const r: Row = {};
  const warnings: string[] = [];
  for (const [k, v] of Object.entries(raw)) {
    if (!fields[k]) throw new Error("未知の項目です");
    if (v.length > 2000) throw new Error("項目が長すぎます");
    r[k] = blank(v) ? null : v.trim();
  }
  if (r.data_kind !== mode)
    throw new Error(
      "data_kind と取込先DBが一致しません。demo / real を明示してください",
    );
  for (const k of [
    "lat",
    "lng",
    "units",
    "avg_diff",
    "total_diff",
    "positive_units",
    "positive_rate",
    "games",
    "payout_rate",
  ])
    if (k in r) {
      r[k] = numeric(
        String(r[k] ?? ""),
        ["positive_rate", "payout_rate"].includes(k),
      );
      if (r[k] !== null && String(r[k]) !== raw[k]?.trim())
        warnings.push(`${fields[k]}を ${r[k]} に正規化`);
    }
  for (const k of ["date", "survey_date", "valid_from", "valid_to"])
    if (k in r) {
      r[k] = dateValue(String(r[k] ?? ""));
      if (r[k] && r[k] !== raw[k])
        warnings.push(`${fields[k]}を ${r[k]} に正規化`);
    }
  for (const k of ["published_at", "source_updated_at"])
    if (r[k]) {
      let s = String(r[k]);
      if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(s))
        s = s.replace(" ", "T") + "+09:00";
      if (
        !/(Z|[+-]\d{2}:\d{2})$/.test(s) ||
        !Number.isFinite(Date.parse(s)) ||
        Date.parse(s) > Date.now()
      )
        throw new Error(`${fields[k]}が不正です`);
      r[k] = new Date(s).toISOString();
    }
  required(r.source_url, "出典URL");
  publicUrl.parse(r.source_url);
  if (r.official_url) publicUrl.parse(r.official_url);
  if (kind === "halls") {
    for (const k of ["hall_id", "hall_name", "address", "lat", "lng"])
      required(r[k], fields[k]);
    if (!idPattern.test(String(r.hall_id))) throw new Error("店舗IDが不正です");
    if (
      typeof r.lat !== "number" ||
      r.lat < -90 ||
      r.lat > 90 ||
      typeof r.lng !== "number" ||
      r.lng < -180 ||
      r.lng > 180
    )
      throw new Error("座標が範囲外です");
    const old = db
      .prepare(
        "SELECT h.name,l.* FROM halls h JOIN hall_locations l ON h.id=l.hall_id WHERE h.id=?",
      )
      .get(String(r.hall_id)) as Row | undefined;
    if (
      old &&
      normalizeHall(String(old.name)) !== normalizeHall(String(r.hall_name)) &&
      mappedIdentity(db, provider, "hall", String(r.hall_name)) !== r.hall_id
    )
      throw new Error("要確認: 店舗名が一致しません。別名登録が必要です");
    if (
      old &&
      (old.address !== r.address || old.lat !== r.lat || old.lng !== r.lng)
    )
      throw new Error(
        "要確認: 既存店舗と住所・座標が異なります。移転等を確認してください",
      );
    const other = (
      db
        .prepare(
          "SELECT h.id,h.name,l.address FROM halls h JOIN hall_locations l ON h.id=l.hall_id WHERE h.id!=?",
        )
        .all(String(r.hall_id)) as Row[]
    ).find(
      (h) =>
        normalizeHall(String(h.name)) === normalizeHall(String(r.hall_name)) &&
        h.address === r.address,
    );
    if (other)
      throw new Error(`要確認: 同名・同住所の店舗 ${other.id} が存在します`);
  } else {
    identity(db, provider, "hall", r, warnings);
    identity(db, provider, "machine", r, warnings);
    integer(r.units, "台数", 1, 10000);
    if (kind === "installations") {
      r.valid_from = r.valid_from || r.survey_date;
      required(r.valid_from, "有効開始日または調査日");
      if (r.valid_to && String(r.valid_to) < String(r.valid_from))
        throw new Error("有効終了日が開始日より前です");
      if (!r.valid_to)
        warnings.push("有効終了日なし：将来も有効として扱います");
    } else {
      required(r.date, "営業日");
      if (String(r.date) > todayJST())
        throw new Error("未来の営業日は実績として登録できません");
      if (r.avg_diff == null && r.total_diff == null)
        throw new Error("平均差枚または総差枚が必要です");
      if (r.total_diff != null) integer(r.total_diff, "総差枚", -1e9, 1e9);
      if (
        r.avg_diff != null &&
        r.total_diff != null &&
        Math.abs(Number(r.avg_diff) - Number(r.total_diff) / Number(r.units)) >
          0.500001
      )
        throw new Error(
          "要確認: 平均差枚と総差枚が整合しません（丸め許容0.5枚）",
        );
      if (r.total_diff == null) warnings.push("総差枚は未取得のまま保存します");
      if (r.positive_units != null)
        integer(r.positive_units, "プラス台数", 0, Number(r.units));
      if (r.positive_rate != null) {
        if (Number(r.positive_rate) < 0 || Number(r.positive_rate) > 100)
          throw new Error("プラス台率が範囲外です");
        if (
          r.positive_units != null &&
          Math.abs(
            Number(r.positive_rate) -
              (Number(r.positive_units) / Number(r.units)) * 100,
          ) > 0.51
        )
          throw new Error("要確認: プラス台率と台数が整合しません");
        else if (r.positive_units == null)
          warnings.push("プラス台率のみ：台数を推定せず参考値として保存");
      }
      if (r.games != null) integer(r.games, "平均G数", 0, 100000);
      if (r.win_rate != null || r.points != null || r.payout_rate != null)
        warnings.push(
          "勝率・出玉率・ポイントは別項目で保存し、プラス台率や差枚に換算しません",
        );
    }
  }
  for (const entity of ["hall", "machine"]) {
    const external = r[`${entity}_external_id`];
    if (external && r[`${entity}_id`]) {
      const old = db
        .prepare(
          "SELECT canonical_id FROM external_identities WHERE source_id=? AND entity=? AND external_id=?",
        )
        .get(provider, entity, String(external)) as
        { canonical_id: string } | undefined;
      if (old && old.canonical_id !== r[`${entity}_id`])
        throw new Error("要確認: 外部IDの対応先が一致しません");
    }
  }
  r.definition = definition;
  return { row: r, warnings };
}
export const recordKey = (kind: ImportKind, r: Row) =>
  JSON.stringify(
    kind === "halls"
      ? [r.hall_id]
      : kind === "installations"
        ? [r.hall_id, r.machine_id, r.valid_from]
        : [r.hall_id, r.machine_id, r.date],
  );
function configCheck(
  headers: string[],
  kind: ImportKind,
  input: PreviewConfig,
) {
  if (
    !input ||
    !input.confirmed ||
    typeof input.definition !== "string" ||
    !input.definition.trim() ||
    input.definition.length > 4000
  )
    throw new Error("項目の定義と保存利用条件を確認してください");
  if (!input.mapping || !input.defaults)
    throw new Error("マッピングが必要です");
  const assigned: string[] = [];
  for (const [h, f] of Object.entries(input.mapping)) {
    if (!headers.includes(h) || typeof f !== "string" || (f && !fields[f]))
      throw new Error("マッピングが不正です");
    if (f) assigned.push(f);
  }
  if (new Set(assigned).size !== assigned.length)
    throw new Error("同じDB項目に複数の列を割り当てています");
  for (const [f, v] of Object.entries(input.defaults))
    if (!fields[f] || typeof v !== "string" || v.length > 2000)
      throw new Error("共通値が不正です");
  const provided = new Set([
    ...assigned,
    ...Object.keys(input.defaults).filter((k) => input.defaults[k]),
  ]);
  for (const group of [...requiredGroups[kind], ["source_url"]])
    if (!group.some((k) => provided.has(k)))
      throw new Error(
        `必須項目: ${group.map((k) => fields[k]).join(" または ")}`,
      );
}
function mappedRaw(headers: string[], raw: string[], config: PreviewConfig) {
  if (raw.length !== headers.length)
    throw new Error("列数がヘッダーと一致しません");
  const result = { ...config.defaults };
  headers.forEach((h, i) => {
    if (config.mapping[h]) result[config.mapping[h]] = raw[i];
  });
  return result;
}
type RecordState = {
  id: number;
  fingerprint: string;
  adopted: number;
  payload_json: string;
  source_id: string;
};
export function previewCsv(
  db: DatabaseSync,
  id: string,
  mode: "demo" | "real",
  config: PreviewConfig,
) {
  const file = getFile(db, id);
  if (!["staged", "preview"].includes(file.status))
    throw new Error("このファイルはプレビューできません");
  requireSource(db, file.source_id);
  const headers = JSON.parse(file.headers_json) as string[];
  configCheck(headers, file.kind, config);
  const seen = new Set<string>();
  const counts: Record<string, number> = {
    normal: 0,
    warning: 0,
    duplicate: 0,
    review: 0,
    invalid: 0,
  };
  db.exec("BEGIN IMMEDIATE");
  try {
    const update = db.prepare(
      "UPDATE import_rows SET status=?,messages_json=?,normalized_json=? WHERE file_id=? AND line=?",
    );
    for (const staged of db
      .prepare("SELECT * FROM import_rows WHERE file_id=? ORDER BY line")
      .iterate(id)) {
      let status = "normal",
        row: Row | null = null,
        messages: string[] = [];
      try {
        const parsed = normalizeRow(
          db,
          file.source_id,
          file.kind,
          mappedRaw(headers, JSON.parse(staged.raw_json as string), config),
          mode,
          config.definition,
        );
        row = parsed.row;
        messages = parsed.warnings;
        const key = recordKey(file.kind, row),
          hash = fingerprint(row);
        if (seen.has(key))
          throw new Error(
            "同じファイル内に同一キーがあります。重複行を除いて再アップロードしてください",
          );
        seen.add(key);
        const old = db
          .prepare(
            "SELECT * FROM collected_records WHERE source_id=? AND kind=? AND record_key=?",
          )
          .get(file.source_id, file.kind, key) as RecordState | undefined;
        if (old?.fingerprint === hash) {
          status = "duplicate";
          messages.push("同じ出典・キー・内容を登録済み");
        } else {
          if (old)
            messages.push("同一出典の訂正：採用中のデータのみ更新します");
          const other = db
            .prepare(
              "SELECT id FROM collected_records WHERE source_id!=? AND kind=? AND record_key=?",
            )
            .get(file.source_id, file.kind, key);
          if (other)
            messages.push(
              "別出典の記録があります。個別保存し、採用値を上書きしません",
            );
          status = messages.length ? "warning" : "normal";
        }
      } catch (e) {
        const m = e instanceof Error ? e.message : "検証失敗";
        messages = [m];
        status = m.startsWith("要確認") ? "review" : "invalid";
      }
      counts[status]++;
      update.run(
        status,
        JSON.stringify(messages),
        row ? JSON.stringify(row) : null,
        id,
        staged.line,
      );
    }
    db.prepare(
      "UPDATE import_files SET status='preview',config_json=?,summary_json=? WHERE id=?",
    ).run(JSON.stringify(config), JSON.stringify(counts), id);
    if (config.saveMapping)
      db.prepare(
        "INSERT INTO csv_mappings VALUES(?,?,?,?,?) ON CONFLICT(source_id,kind) DO UPDATE SET signature=excluded.signature,mapping_json=excluded.mapping_json,updated_at=excluded.updated_at",
      ).run(
        file.source_id,
        file.kind,
        file.signature,
        JSON.stringify(config.mapping),
        new Date().toISOString(),
      );
    db.exec("COMMIT");
    return counts;
  } catch (e) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw e;
  }
}
function storeIdentity(db: DatabaseSync, provider: string, r: Row) {
  for (const entity of ["hall", "machine"]) {
    if (r[`${entity}_external_id`] && r[`${entity}_id`])
      db.prepare(
        "INSERT OR IGNORE INTO external_identities VALUES(?,?,?,?)",
      ).run(
        provider,
        entity,
        String(r[`${entity}_external_id`]),
        String(r[`${entity}_id`]),
      );
  }
}
function applyRow(
  db: DatabaseSync,
  kind: ImportKind,
  r: Row,
  job: number,
  sourceId: string,
  now: string,
) {
  const hall = String(r.hall_id),
    machine = String(r.machine_id || "");
  if (kind === "halls") {
    db.prepare(
      "INSERT INTO halls(id,name,official_url,hours,lottery_time) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET official_url=coalesce(excluded.official_url,halls.official_url),hours=coalesce(excluded.hours,halls.hours),lottery_time=coalesce(excluded.lottery_time,halls.lottery_time)",
    ).run(
      hall,
      String(r.hall_name),
      r.official_url ?? null,
      r.hours ?? null,
      r.lottery_time ?? null,
    );
    db.prepare("INSERT OR IGNORE INTO hall_locations VALUES(?,?,?,?)").run(
      hall,
      String(r.address),
      Number(r.lat),
      Number(r.lng),
    );
  } else {
    db.prepare(
      "INSERT OR IGNORE INTO machines(id,name,manufacturer,model) VALUES(?,?,?,?)",
    ).run(
      machine,
      String(r.machine_name || machine),
      r.manufacturer ?? null,
      r.model ?? null,
    );
    if (r.machine_name)
      db.prepare("INSERT OR IGNORE INTO machine_aliases VALUES(?,?)").run(
        normalizeMachine(String(r.machine_name)),
        machine,
      );
    if (kind === "installations")
      db.prepare(
        "INSERT INTO hall_machine_installations VALUES(?,?,?,?,?) ON CONFLICT(hall_id,machine_id,valid_from) DO UPDATE SET valid_to=excluded.valid_to,units=excluded.units",
      ).run(
        hall,
        machine,
        String(r.valid_from),
        r.valid_to ?? null,
        Number(r.units),
      );
    else
      writeCanonical(
        db,
        {
          hall_id: hall,
          machine_id: machine,
          date: String(r.date),
          units: Number(r.units),
          avg_diff: r.avg_diff == null ? null : Number(r.avg_diff),
          total_diff: r.total_diff == null ? null : Number(r.total_diff),
          positive_units:
            r.positive_units == null ? null : Number(r.positive_units),
          games: r.games == null ? null : Number(r.games),
          source_id: sourceId,
        },
        job,
        now,
      );
  }
}
export function commitCsv(
  db: DatabaseSync,
  id: string,
  mode: "demo" | "real",
  includeWarnings: boolean,
) {
  const file = getFile(db, id);
  if (file.status === "committed") return JSON.parse(file.summary_json!);
  if (file.status !== "preview" || !file.config_json)
    throw new Error("先にプレビューしてください");
  const source = requireSource(db, file.source_id),
    config = JSON.parse(file.config_json) as PreviewConfig;
  const now = new Date().toISOString(),
    summary = {
      inserted: 0,
      updated: 0,
      retained: 0,
      duplicate: 0,
      excluded: 0,
      failed: 0,
      analysis: "登録完了後の検索から最新DBを集計（キャッシュなし）",
    };
  db.exec("BEGIN IMMEDIATE");
  try {
    const job = Number(
      db
        .prepare(
          "INSERT INTO import_jobs(started_at,status,source) VALUES(?,?,?)",
        )
        .run(now, "running", `CSV: ${file.filename}`).lastInsertRowid,
    );
    for (const staged of db
      .prepare("SELECT * FROM import_rows WHERE file_id=? ORDER BY line")
      .iterate(id)) {
      if (staged.status === "duplicate") {
        summary.duplicate++;
        continue;
      }
      if (
        staged.status !== "normal" &&
        !(includeWarnings && staged.status === "warning")
      ) {
        summary.excluded++;
        continue;
      }
      db.exec("SAVEPOINT csv_row");
      try {
        const r = normalizeRow(
          db,
          file.source_id,
          file.kind,
          mappedRaw(
            JSON.parse(file.headers_json),
            JSON.parse(staged.raw_json as string),
            config,
          ),
          mode,
          config.definition,
        ).row;
        const key = recordKey(file.kind, r),
          hash = fingerprint(r),
          old = db
            .prepare(
              "SELECT * FROM collected_records WHERE source_id=? AND kind=? AND record_key=?",
            )
            .get(file.source_id, file.kind, key) as RecordState | undefined;
        if (old?.fingerprint === hash) {
          summary.duplicate++;
          db.exec("RELEASE csv_row");
          continue;
        }
        const other = db
          .prepare(
            "SELECT * FROM collected_records WHERE kind=? AND record_key=? AND adopted=1",
          )
          .get(file.kind, key) as RecordState | undefined;
        let adopted = old ? !!old.adopted : !other;
        // Existing legacy records must not silently be replaced by a new pipeline source.
        if (
          !old &&
          !other &&
          file.kind === "results" &&
          db
            .prepare(
              "SELECT 1 FROM daily_machine_results WHERE hall_id=? AND machine_id=? AND date=?",
            )
            .get(String(r.hall_id), String(r.machine_id), String(r.date))
        )
          adopted = false;
        if (
          !old &&
          !other &&
          file.kind === "installations" &&
          db
            .prepare(
              "SELECT 1 FROM hall_machine_installations WHERE hall_id=? AND machine_id=? AND valid_from=?",
            )
            .get(String(r.hall_id), String(r.machine_id), String(r.valid_from))
        )
          adopted = false;
        const reason = adopted
          ? old
            ? "採用済み同一出典の訂正"
            : "最初の検証済み出典を採用"
          : "既存採用値を保持。別出典として保存（競合解決はPhase 2）";
        const sourceId = `csv-${fingerprint([file.source_id, r.source_url, config.definition]).slice(0, 24)}`;
        db.prepare(
          "INSERT INTO data_sources VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET retrieved_at=excluded.retrieved_at,permission=excluded.permission",
        ).run(
          sourceId,
          source.name,
          String(r.source_url),
          "csv",
          source.permission,
          "提供者申告・未監査",
          config.definition,
          file.created_at,
          r.published_at ?? null,
        );
        if (adopted) applyRow(db, file.kind, r, job, sourceId, now);
        // Do not attach external identifiers to a new unadopted entity that was not created.
        if (adopted) storeIdentity(db, file.source_id, r);
        const result = db
          .prepare(
            "INSERT INTO collected_records(source_id,kind,record_key,payload_json,fingerprint,file_id,line,adopted,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id,kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,fingerprint=excluded.fingerprint,file_id=excluded.file_id,line=excluded.line,reason=excluded.reason RETURNING id",
          )
          .get(
            file.source_id,
            file.kind,
            key,
            JSON.stringify(r),
            hash,
            id,
            staged.line,
            adopted ? 1 : 0,
            reason,
            now,
          ) as { id: number };
        db.prepare(
          "INSERT INTO collected_revisions(record_id,file_id,before_json,after_json,created_at) VALUES(?,?,?,?,?)",
        ).run(result.id, id, old?.payload_json ?? null, JSON.stringify(r), now);
        if (!adopted) summary.retained++;
        else if (old) summary.updated++;
        else summary.inserted++;
        db.exec("RELEASE csv_row");
      } catch (e) {
        db.exec("ROLLBACK TO csv_row; RELEASE csv_row");
        summary.failed++;
        db.prepare(
          "UPDATE import_rows SET status='invalid',messages_json=? WHERE file_id=? AND line=?",
        ).run(
          JSON.stringify([e instanceof Error ? e.message : "登録失敗"]),
          id,
          staged.line,
        );
      }
    }
    db.prepare(
      "UPDATE import_jobs SET status=?,finished_at=?,row_count=?,error=? WHERE id=?",
    ).run(
      summary.failed ? "partial" : "success",
      now,
      summary.inserted + summary.updated + summary.retained,
      summary.failed ? `${summary.failed}行失敗` : null,
      job,
    );
    db.prepare(
      "UPDATE import_files SET status='committed',summary_json=?,finished_at=? WHERE id=?",
    ).run(JSON.stringify(summary), now, id);
    db.exec("COMMIT");
    return summary;
  } catch (e) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw e;
  }
}
