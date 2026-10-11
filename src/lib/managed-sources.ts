import { validDate, todayJST } from "./calendar";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
export const publicUrl = z
  .string()
  .url()
  .max(2000)
  .refine((v) => {
    const u = new URL(v);
    return (
      ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
    );
  }, "出典URLは認証情報・クエリ・フラグメントのない公開URLにしてください");
export const sourceConfigSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
    name: z.string().trim().min(1).max(120),
    url: publicUrl,
    category: z.string().max(300).default(""),
    method: z.enum(["manual", "csv", "paste", "input", "automatic"]),
    enabled: z.boolean(),
    priority: z.number().int().min(0).max(10000),
    storageAllowed: z.boolean(),
    autoAllowed: z.boolean(),
    permission: z.string().max(4000),
    checkedAt: z.string().max(10),
    frequency: z.string().max(120),
  })
  .strict()
  .superRefine((s, c) => {
    if (
      (s.storageAllowed || s.autoAllowed) &&
      (!s.permission.trim() ||
        !validDate(s.checkedAt) ||
        s.checkedAt > todayJST())
    )
      c.addIssue({ code: "custom", message: "許可根拠と確認日が必要です" });
    if (s.method === "automatic" && (!s.autoAllowed || !s.storageAllowed))
      c.addIssue({
        code: "custom",
        message: "許諾未確認の自動取得は設定できません",
      });
  });
export type ManagedSource = z.infer<typeof sourceConfigSchema>;
export function getSource(db: DatabaseSync, id: string): ManagedSource {
  const row = db
    .prepare("SELECT config_json FROM managed_sources WHERE id=?")
    .get(id) as { config_json: string } | undefined;
  if (!row) throw new Error("取得元がありません");
  return JSON.parse(row.config_json);
}
export function saveSource(db: DatabaseSync, input: unknown) {
  const value = sourceConfigSchema.parse(input);
  db.prepare(
    "INSERT INTO managed_sources VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json,updated_at=excluded.updated_at",
  ).run(value.id, JSON.stringify(value), new Date().toISOString());
  return value;
}
export function requireSource(db: DatabaseSync, id: string) {
  const s = getSource(db, id);
  if (!s.enabled) throw new Error("取得元が無効です");
  if (!s.storageAllowed || !s.permission.trim() || !s.checkedAt)
    throw new Error(
      "保存・再利用の許可根拠と確認日を取得元設定に登録してください",
    );
  return s;
}
export function assertAutomaticAllowed(db: DatabaseSync, id: string): never {
  const s = requireSource(db, id);
  if (!s.autoAllowed || s.method !== "automatic")
    throw new Error("この取得元の自動取得は許可されていません");
  throw new Error(
    "自動実行・スケジューラーはPhase 3で接続します。現在はCSVアップロードを利用してください",
  );
}
