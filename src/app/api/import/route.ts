import { NextResponse } from "next/server";
import { timingSafeEqual, createHash } from "node:crypto";
import { getDb } from "@/lib/db";
import { importCsv } from "@/lib/importer";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const token = process.env.ADMIN_IMPORT_TOKEN;
  if (!token)
    return NextResponse.json(
      { error: "サーバーに ADMIN_IMPORT_TOKEN を設定してください。" },
      { status: 503 },
    );
  const provided =
    req.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  const hash = (s: string) => createHash("sha256").update(s).digest();
  if (!timingSafeEqual(hash(token), hash(provided)))
    return NextResponse.json(
      { error: "管理トークンが一致しません。" },
      { status: 401 },
    );
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      // Next may normalize req.url to localhost behind a proxy. The public Host
      // header remains the browser-visible authority and must be preserved.
      if (
        !["http:", "https:"].includes(parsedOrigin.protocol) ||
        parsedOrigin.host !== req.headers.get("host")
      ) {
        return NextResponse.json(
          { error: "同一オリジンから操作してください。" },
          { status: 403 },
        );
      }
    } catch {
      return NextResponse.json(
        { error: "不正なOriginです。" },
        { status: 403 },
      );
    }
  }
  const mode = new URL(req.url).searchParams.get("mode");
  if (mode !== "real" && mode !== "demo")
    return NextResponse.json(
      { error: "取込先を指定してください。" },
      { status: 400 },
    );
  try {
    const reader = req.body?.getReader();
    if (!reader) throw new Error("CSVが必要です");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 2_000_000) {
        await reader.cancel();
        return NextResponse.json(
          { error: "CSVは2MB以下にしてください" },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
    return NextResponse.json(
      importCsv(getDb(mode), Buffer.concat(chunks).toString("utf8"), mode),
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "取込失敗" },
      { status: 400 },
    );
  }
}
