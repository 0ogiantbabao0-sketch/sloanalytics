import { NextResponse } from "next/server";
import { authorizeAdmin, readImportBody } from "@/lib/admin-request";
import { getDb } from "@/lib/db";
import { importCsv, importRecords } from "@/lib/importer";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const denied = await authorizeAdmin(req);
  if (denied) return denied;
  const mode = new URL(req.url).searchParams.get("mode");
  if (mode !== "real" && mode !== "demo")
    return NextResponse.json(
      { error: "取込先を指定してください。" },
      { status: 400 },
    );
  try {
    const body = await readImportBody(req);
    const db = getDb(mode);
    if (req.headers.get("content-type")?.split(";")[0] === "application/json") {
      const input = JSON.parse(body);
      if (!Array.isArray(input.rows) || input.rows.length !== 1)
        throw new Error("手動登録は1件ずつ入力してください");
      return NextResponse.json(importRecords(db, input.rows, mode));
    }
    return NextResponse.json(importCsv(db, body, mode));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "取込失敗" },
      { status: e instanceof Error && e.message.includes("2MB") ? 413 : 400 },
    );
  }
}
