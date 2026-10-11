import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdmin, readImportBody } from "@/lib/admin-request";
import { getDb, all } from "@/lib/db";
import { registerMapping } from "@/lib/identities";
import { selectObservation } from "@/lib/importer";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function modeOf(req: Request) {
  return z
    .enum(["demo", "real"])
    .parse(new URL(req.url).searchParams.get("mode"));
}
export async function GET(req: Request) {
  const denied = await authorizeAdmin(req);
  if (denied) return denied;
  try {
    const db = getDb(modeOf(req));
    return NextResponse.json({
      mappings: all(
        db,
        "SELECT * FROM source_identity_mappings ORDER BY created_at DESC LIMIT 100",
      ),
      observations: all(
        db,
        `SELECT o.*, s.name AS source_name, s.url AS source_url, s.permission,
        h.name AS hall_name, m.name AS machine_name,
        CASE WHEN r.source_id=o.source_id THEN 1 ELSE 0 END AS selected,
        r.total_diff AS selected_total_diff
        FROM source_observations o JOIN data_sources s ON s.id=o.source_id
        JOIN halls h ON h.id=o.hall_id JOIN machines m ON m.id=o.machine_id
        LEFT JOIN daily_machine_results r ON r.hall_id=o.hall_id AND r.machine_id=o.machine_id AND r.date=o.date
        ORDER BY o.imported_at DESC,o.id DESC LIMIT 100`,
      ),
    });
  } catch {
    return NextResponse.json(
      { error: "取込先を指定してください" },
      { status: 400 },
    );
  }
}
export async function POST(req: Request) {
  const denied = await authorizeAdmin(req);
  if (denied) return denied;
  try {
    const db = getDb(modeOf(req));
    const input = JSON.parse(await readImportBody(req));
    if (input.action === "mapping")
      return NextResponse.json(registerMapping(db, input.mapping));
    if (input.action === "select") {
      const id = z.number().int().positive().parse(input.id);
      return NextResponse.json(selectObservation(db, id));
    }
    throw new Error("操作を指定してください");
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "操作に失敗しました" },
      { status: 400 },
    );
  }
}
