import { NextResponse } from "next/server";
import { timingSafeEqual, createHash } from "node:crypto";
import { COOKIE_NAME, createSession, privateAccess } from "@/lib/owner-session";
let attempts = 0,
  until = 0;
export async function POST(req: Request) {
  if (!privateAccess())
    return NextResponse.json(
      { error: "本人用認証は無効です" },
      { status: 400 },
    );
  const origin = req.headers.get("origin");
  if (!origin || new URL(origin).host !== req.headers.get("host"))
    return NextResponse.json(
      { error: "同一サイトから操作してください" },
      { status: 403 },
    );
  if (new URL(req.url).searchParams.get("logout") === "1") {
    const r = NextResponse.redirect(new URL("/login", origin), 303);
    r.cookies.set(COOKIE_NAME, "", {
      maxAge: 0,
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
    });
    return r;
  }
  const password = process.env.OWNER_PASSWORD;
  if (
    !password ||
    password.length < 16 ||
    !process.env.OWNER_SESSION_SECRET ||
    process.env.OWNER_SESSION_SECRET.length < 32
  )
    return NextResponse.json(
      { error: "管理者の認証設定が必要です" },
      { status: 503 },
    );
  if (Date.now() < until)
    return NextResponse.json(
      { error: "試行回数が多いため5分後に再試行してください" },
      { status: 429 },
    );
  let data: string;
  try {
    const reader = req.body?.getReader();
    if (!reader) throw new Error();
    let s = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      s += value.length;
      if (s > 2048) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(value);
    }
    data = String(JSON.parse(Buffer.concat(chunks).toString()).password || "");
  } catch {
    return NextResponse.json({ error: "入力形式が不正です" }, { status: 400 });
  }
  const hash = (v: string) => createHash("sha256").update(v).digest();
  if (!timingSafeEqual(hash(password), hash(data))) {
    attempts++;
    if (attempts >= 5) {
      until = Date.now() + 300000;
      attempts = 0;
    }
    return NextResponse.json(
      { error: "パスワードが一致しません" },
      { status: 401 },
    );
  }
  attempts = 0;
  until = 0;
  const r = NextResponse.json({ ok: true });
  r.cookies.set(COOKIE_NAME, await createSession(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 43200,
  });
  r.headers.set("Cache-Control", "no-store");
  return r;
}
