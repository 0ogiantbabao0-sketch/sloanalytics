import { NextResponse } from "next/server";
import { timingSafeEqual, createHash } from "node:crypto";
export function authorizeAdmin(req: Request) {
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
  return null;
}

export async function readImportBody(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("入力データが必要です");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2_000_000) {
      await reader.cancel();
      throw new Error("入力は2MB以下にしてください");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
