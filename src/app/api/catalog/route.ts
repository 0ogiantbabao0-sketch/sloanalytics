import { NextResponse } from "next/server";
import { getDb, all } from "@/lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(req: Request) {
  const mode =
    new URL(req.url).searchParams.get("mode") === "real" ? "real" : "demo";
  const db = getDb(mode);
  return NextResponse.json({
    halls: all(
      db,
      "SELECT h.*,l.address,l.lat,l.lng FROM halls h JOIN hall_locations l ON h.id=l.hall_id",
    ),
    machines: all(db, "SELECT * FROM machines ORDER BY name"),
    aliases: all(db, "SELECT * FROM machine_aliases"),
    sources: all(db, "SELECT * FROM data_sources"),
    jobs: all(db, "SELECT * FROM import_jobs ORDER BY id DESC LIMIT 30"),
  });
}
