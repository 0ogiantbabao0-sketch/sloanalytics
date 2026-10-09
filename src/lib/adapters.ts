import type { DatabaseSync } from "node:sqlite";
import { importCsv } from "./importer";
export interface DataAdapter {
  name: string;
  fetchCsv(): Promise<string>;
}
export class PermittedCsvAdapter implements DataAdapter {
  name = "permitted-csv";
  constructor(
    private url: string,
    private allowedHost: string,
  ) {}
  async fetchCsv() {
    const u = new URL(this.url);
    if (
      u.protocol !== "https:" ||
      u.hostname !== this.allowedHost ||
      u.username ||
      u.password
    )
      throw new Error("許可済みのHTTPSホストを指定してください");
    const res = await fetch(u, {
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`取得失敗: HTTP ${res.status}`);
    if (!res.body) throw new Error("レスポンスが空です");
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) {
        await reader.cancel();
        throw new Error("CSV上限2MBを超えました");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
}
export async function runAdapter(db: DatabaseSync, adapter: DataAdapter) {
  let csv: string;
  try {
    csv = await adapter.fetchCsv();
  } catch (e) {
    db.prepare(
      "INSERT INTO import_jobs(started_at,finished_at,status,source,error) VALUES(?,?,?,?,?)",
    ).run(
      new Date().toISOString(),
      new Date().toISOString(),
      "failed",
      adapter.name,
      e instanceof Error ? e.message : "取得失敗",
    );
    throw e;
  }
  return importCsv(db, csv, "real", adapter.name);
}
