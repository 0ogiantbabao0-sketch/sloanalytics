import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authorizeAdmin, readImportBody } from "@/lib/admin-request";
import { stageCsv, getFile } from "@/lib/csv-files";
import { previewCsv, commitCsv } from "@/lib/csv-workspace";
import { saveSource, assertAutomaticAllowed } from "@/lib/managed-sources";
import { normalizeHall } from "@/lib/identities";
import { normalizeMachine } from "@/lib/calendar";
import type { ImportKind } from "@/lib/csv-dictionary";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function mode(req: Request) {
  const value = new URL(req.url).searchParams.get("mode");
  if (value !== "demo" && value !== "real")
    throw new Error("取込先を選択してください");
  return value;
}
const error = (e: unknown) =>
  NextResponse.json(
    { error: e instanceof Error ? e.message : "処理失敗" },
    { status: 400 },
  );
export async function GET(req: Request) {
  const denied = await authorizeAdmin(req);
  if (denied) return denied;
  try {
    const db = getDb(mode(req)),
      p = new URL(req.url).searchParams,
      id = p.get("id");
    if (id) {
      const f = getFile(db, id);
      const status = p.get("status"),
        offset = Math.max(0, Number(p.get("offset")) || 0);
      const rows = db
        .prepare(
          `SELECT line,raw_json,status,messages_json,normalized_json FROM import_rows WHERE file_id=? ${status ? "AND status=?" : ""} ORDER BY line LIMIT 100 OFFSET ?`,
        )
        .all(...(status ? [id, status, offset] : [id, offset]));
      if (p.get("download") === "errors") {
        const encoder = new TextEncoder();
        const headers = JSON.parse(f.headers_json) as string[];
        const escape = (v: unknown) =>
          `"${String(v ?? "")
            .replace(/^[=+@\-\t\r]/, "'$&")
            .replaceAll('"', '""')}"`;
        const iterator = db
          .prepare(
            "SELECT line,raw_json,status,messages_json FROM import_rows WHERE file_id=? AND status IN ('invalid','review') ORDER BY line",
          )
          .iterate(id);
        let first = true;
        const stream = new ReadableStream({
          pull(controller) {
            if (first) {
              controller.enqueue(
                encoder.encode(
                  "\ufeff" +
                    ["CSVレコード番号", ...headers, "検証状態", "エラー"]
                      .map(escape)
                      .join(",") +
                    "\r\n",
                ),
              );
              first = false;
              return;
            }
            const n = iterator.next();
            if (n.done) {
              controller.close();
              return;
            }
            const r = n.value;
            controller.enqueue(
              encoder.encode(
                [
                  r.line,
                  ...JSON.parse(r.raw_json as string),
                  r.status,
                  JSON.parse(r.messages_json as string).join(" / "),
                ]
                  .map(escape)
                  .join(",") + "\r\n",
              ),
            );
          },
          cancel() {
            iterator.return?.();
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": "attachment; filename=import-errors.csv",
            "cache-control": "no-store",
          },
        });
      }
      return NextResponse.json({
        file: {
          id: f.id,
          filename: f.filename,
          status: f.status,
          count: f.row_count,
          summary: f.summary_json ? JSON.parse(f.summary_json) : null,
          headers: JSON.parse(f.headers_json),
        },
        rows,
      });
    }
    const sources = db
      .prepare("SELECT id,config_json FROM managed_sources ORDER BY id")
      .all()
      .map((s) => ({
        ...JSON.parse(s.config_json as string),
        stats: db
          .prepare(
            "SELECT count(*) AS files,coalesce(sum(CASE WHEN status='committed' THEN row_count ELSE 0 END),0) AS rows,max(created_at) AS last_attempt,max(CASE WHEN status='committed' THEN finished_at END) AS last_success,sum(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS errors FROM import_files WHERE source_id=?",
          )
          .get(s.id),
        records: db
          .prepare(
            "SELECT count(*) AS records,count(DISTINCT json_extract(payload_json,'$.hall_id')) AS halls,count(DISTINCT json_extract(payload_json,'$.date')) AS days FROM collected_records WHERE source_id=?",
          )
          .get(s.id),
      }));
    return NextResponse.json({
      sources,
      history: db
        .prepare(
          "SELECT id,source_id,kind,filename,status,row_count,summary_json,created_at,finished_at,error FROM import_files ORDER BY created_at DESC LIMIT 100",
        )
        .all(),
      halls: db.prepare("SELECT id,name FROM halls ORDER BY name").all(),
      machines: db.prepare("SELECT id,name FROM machines ORDER BY name").all(),
    });
  } catch (e) {
    return error(e);
  }
}
export async function POST(req: Request) {
  const denied = await authorizeAdmin(req);
  if (denied) return denied;
  try {
    const m = mode(req),
      db = getDb(m),
      p = new URL(req.url).searchParams,
      action = p.get("action");
    if (action === "upload") {
      if (!req.body) throw new Error("ファイルが必要です");
      return NextResponse.json(
        await stageCsv(db, req.body, {
          source: p.get("source") || "",
          kind: p.get("kind") as ImportKind,
          filename: p.get("filename") || "",
          mode: m,
          encoding: p.get("encoding") || "auto",
          delimiter: p.get("delimiter") || "auto",
        }),
      );
    }
    const body = JSON.parse(await readImportBody(req));
    if (action === "source") return NextResponse.json(saveSource(db, body));
    if (action === "automatic") {
      assertAutomaticAllowed(db, body.id);
    }
    if (action === "preview")
      return NextResponse.json(previewCsv(db, body.id, m, body.config));
    if (action === "commit") {
      if (body.confirm !== true || typeof body.includeWarnings !== "boolean")
        throw new Error("登録内容を確認してください");
      return NextResponse.json(commitCsv(db, body.id, m, body.includeWarnings));
    }
    if (action === "alias") {
      const { source, entity, alias, canonical_id, evidence } = body;
      if (
        !["hall", "machine"].includes(entity) ||
        typeof alias !== "string" ||
        !alias.trim() ||
        alias.length > 160 ||
        typeof evidence !== "string" ||
        !evidence.trim() ||
        evidence.length > 1000 ||
        typeof canonical_id !== "string" ||
        typeof source !== "string"
      )
        throw new Error("別名・対応先・根拠が必要です");
      if (!db.prepare("SELECT id FROM managed_sources WHERE id=?").get(source))
        throw new Error("取得元がありません");
      if (
        !db
          .prepare(
            `SELECT id FROM ${entity === "hall" ? "halls" : "machines"} WHERE id=?`,
          )
          .get(canonical_id)
      )
        throw new Error("対応先がありません");
      const normalized =
          entity === "hall" ? normalizeHall(alias) : normalizeMachine(alias),
        old = db
          .prepare(
            "SELECT canonical_id FROM source_identity_mappings WHERE provider_id=? AND entity=? AND alias=?",
          )
          .get(source, entity, normalized);
      if (old && old.canonical_id !== canonical_id)
        throw new Error("別の対応先に登録済みです");
      db.prepare(
        "INSERT OR IGNORE INTO source_identity_mappings VALUES(?,?,?,?,?,?)",
      ).run(
        source,
        entity,
        normalized,
        canonical_id,
        evidence,
        new Date().toISOString(),
      );
      return NextResponse.json({ ok: true });
    }
    if (action === "delete-source") {
      const used = db
        .prepare("SELECT id FROM import_files WHERE source_id=? LIMIT 1")
        .get(body.id);
      if (used)
        throw new Error("履歴のある取得元は削除できません。無効にしてください");
      db.prepare("DELETE FROM managed_sources WHERE id=?").run(body.id);
      return NextResponse.json({ ok: true });
    }
    throw new Error("不明な操作です");
  } catch (e) {
    return error(e);
  }
}
