import { NextResponse } from "next/server";
import { getDb, all } from "@/lib/db";
export const dynamic = "force-dynamic";
export function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const db = getDb(p.get("mode") === "real" ? "real" : "demo");
  const id = p.get("hallId");
  if (!id)
    return NextResponse.json({ error: "hallIdが必要です" }, { status: 400 });
  return NextResponse.json({
    events: all(
      db,
      "SELECT e.*,s.url AS source_url FROM events e LEFT JOIN event_sources s ON s.event_id=e.id WHERE hall_id=? ORDER BY date DESC LIMIT 100",
      id,
    ),
    lottery: all(
      db,
      "SELECT * FROM lottery_records WHERE hall_id=? ORDER BY date DESC LIMIT 100",
      id,
    ),
    units: all(
      db,
      "SELECT u.*,m.name AS machine_name FROM daily_unit_results u JOIN machines m ON m.id=u.machine_id WHERE hall_id=? ORDER BY date DESC,unit_number LIMIT 5000",
      id,
    ),
    installations: all(
      db,
      "SELECT i.*,m.name FROM hall_machine_installations i JOIN machines m ON m.id=i.machine_id WHERE hall_id=? ORDER BY valid_from DESC LIMIT 200",
      id,
    ),
  });
}
