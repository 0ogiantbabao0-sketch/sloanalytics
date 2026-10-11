import { NextResponse, type NextRequest } from "next/server";
import { privateAccess, ownerRequest } from "./lib/owner-session";
export async function middleware(req: NextRequest) {
  if (!privateAccess()) return NextResponse.next();
  const path = req.nextUrl.pathname;
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin");
    let sameOrigin = false;
    try {
      sameOrigin = !!origin && new URL(origin).host === req.headers.get("host");
    } catch {}
    if (!sameOrigin)
      return NextResponse.json(
        { error: "同一サイトから操作してください" },
        { status: 403 },
      );
  }
  if (path === "/api/health" || path === "/login" || path === "/api/session")
    return NextResponse.next();
  if (!(await ownerRequest(req)))
    return path.startsWith("/api/")
      ? NextResponse.json({ error: "ログインしてください" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", req.url));
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
