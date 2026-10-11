import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getWeights, setWeights, weightsSchema } from "@/lib/scoring";
import { compareBacktest } from "@/lib/backtest";
import { authorizeAdmin, readImportBody } from "@/lib/admin-request";
import { searchSchema } from "@/lib/search-schema";
export const runtime = "nodejs";
function mode(req: Request) {
  const m = new URL(req.url).searchParams.get("mode");
  if (m !== "demo" && m !== "real") throw new Error("データ種別が必要です");
  return m;
}
export async function GET(req: Request) {
  const denied = await authorizeAdmin(req);
  if (denied) return denied;
  try {
    const db = getDb(mode(req));
    return NextResponse.json({
      weights: getWeights(db),
      history: db
        .prepare(
          "SELECT id,conditions_json,weights_json,calculated_at FROM backtest_runs ORDER BY id DESC LIMIT 20",
        )
        .all(),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
export async function POST(req: Request) {
  const denied = await authorizeAdmin(req);
  if (denied) return denied;
  try {
    const m = mode(req),
      db = getDb(m),
      body = JSON.parse(await readImportBody(req));
    if (body.action === "weights")
      return NextResponse.json(setWeights(db, body.weights));
    const input = searchSchema.parse(body.input);
    if (input.mode !== m) throw new Error("データ種別が一致しません");
    return NextResponse.json(
      compareBacktest(
        db,
        input,
        body.from,
        body.to,
        weightsSchema.parse(body.weights),
      ),
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "検証失敗" },
      { status: 400 },
    );
  }
}
