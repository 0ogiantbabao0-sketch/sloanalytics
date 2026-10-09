import { getDb } from "@/lib/db";
export const dynamic = "force-dynamic";
export function GET() {
  getDb("real").prepare("SELECT 1").get();
  getDb("demo").prepare("SELECT 1").get();
  return Response.json({ status: "ok", database: "sqlite" });
}
