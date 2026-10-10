import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { importCsv, type ImportContext } from "./importer";
import { providerSchema } from "./identities";

export const adapterConfigSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{1,80}$/),
    providerId: providerSchema,
    url: z.url(),
    allowedHost: z.string().min(1),
    permission: z
      .object({
        status: z.literal("approved"),
        reference: z.string().trim().min(1).max(1000),
        automatedRetrieval: z.literal(true),
        redistribution: z.literal(true),
        checkedAt: z.iso.datetime({ offset: true }),
        expiresAt: z.iso.datetime({ offset: true }),
        minimumIntervalSeconds: z.number().int().min(60),
      })
      .strict(),
  })
  .strict();
export type AdapterConfig = z.infer<typeof adapterConfigSchema>;
export const adapterConfigsSchema = z
  .array(adapterConfigSchema)
  .min(1)
  .max(30)
  .refine(
    (items) => new Set(items.map((v) => v.id)).size === items.length,
    "アダプタIDが重複しています",
  );

export interface DataAdapter {
  name: string;
  context: ImportContext;
  validate(db: DatabaseSync): void;
  fetchCsv(): Promise<string>;
}

// One independent instance per contracted provider/feed. No HTML scrapers are installed.
export class PermittedCsvAdapter implements DataAdapter {
  readonly name: string;
  readonly context: ImportContext;
  private config: AdapterConfig;
  constructor(config: AdapterConfig) {
    this.config = adapterConfigSchema.parse(config);
    this.name = `licensed-csv:${config.id}`;
    this.context = {
      method: "licensed-csv",
      providerId: config.providerId,
      permission: config.permission.reference,
    };
  }
  validate(db: DatabaseSync) {
    this.validatePermission();
    const previous = db
      .prepare(
        "SELECT started_at FROM import_jobs WHERE source=? ORDER BY id DESC LIMIT 1",
      )
      .get(this.name) as { started_at: string } | undefined;
    if (
      previous &&
      Date.now() - Date.parse(previous.started_at) <
        this.config.permission.minimumIntervalSeconds * 1000
    )
      throw new Error("許可された取得間隔に達していません");
  }
  private validatePermission() {
    const { permission, url, allowedHost } = this.config;
    if (
      Date.parse(permission.checkedAt) > Date.now() ||
      Date.parse(permission.expiresAt) <= Date.now() ||
      Date.parse(permission.expiresAt) <= Date.parse(permission.checkedAt)
    )
      throw new Error("許諾確認日・有効期限を確認してください");
    const u = new URL(url);
    if (
      u.protocol !== "https:" ||
      u.hostname !== allowedHost ||
      u.port ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      throw new Error(
        "認証情報・クエリを含まない許可済みHTTPSホストを指定してください",
      );
    return u;
  }
  async fetchCsv() {
    const u = this.validatePermission();
    let res: Response;
    try {
      res = await fetch(u, {
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error(
        "HTTPS CSVの取得に失敗しました（接続・TLS・リダイレクト・時間切れを確認）",
      );
    }
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
    adapter.validate(db);
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
  return importCsv(db, csv, "real", adapter.name, adapter.context);
}
export async function runAdapters(db: DatabaseSync, adapters: DataAdapter[]) {
  const results: {
    name: string;
    ok: boolean;
    error?: string;
    result?: ReturnType<typeof importCsv>;
  }[] = [];
  // Sequential requests and independent transactions; a failed provider does not discard another's data.
  for (const adapter of adapters) {
    try {
      results.push({
        name: adapter.name,
        ok: true,
        result: await runAdapter(db, adapter),
      });
    } catch (e) {
      results.push({
        name: adapter.name,
        ok: false,
        error: e instanceof Error ? e.message : "取得失敗",
      });
    }
  }
  return results;
}
