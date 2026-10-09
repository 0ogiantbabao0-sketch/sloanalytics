import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { search } from "@/lib/analytics";
import { searchSchema } from "@/lib/search-schema";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const parsed = searchSchema.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json(
        { error: parsed.error.issues.map((e) => e.message).join(" / ") },
        { status: 400 },
      );
    return NextResponse.json(search(getDb(parsed.data.mode), parsed.data));
  } catch {
    return NextResponse.json(
      {
        error:
          "検索を処理できませんでした。入力とサーバーログを確認してください。",
      },
      { status: 500 },
    );
  }
}
