import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { normalizeMachine } from "./calendar";
import { providerIds } from "./source-catalog";

export const providerSchema = z
  .string()
  .refine((id) => providerIds.includes(id), "取得元を指定してください");
export const normalizeHall = (value: string) =>
  value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
export const mappingSchema = z
  .object({
    provider_id: providerSchema,
    entity: z.enum(["hall", "machine"]),
    alias: z.string().trim().min(1).max(160),
    canonical_id: z.string().min(1).max(80),
    evidence: z.string().trim().min(1).max(1000),
  })
  .strict();

export function mappedIdentity(
  db: DatabaseSync,
  provider: string,
  entity: "hall" | "machine",
  alias: string,
) {
  const normalized =
    entity === "hall" ? normalizeHall(alias) : normalizeMachine(alias);
  return (
    db
      .prepare(
        "SELECT canonical_id FROM source_identity_mappings WHERE provider_id=? AND entity=? AND alias=?",
      )
      .get(provider, entity, normalized) as { canonical_id: string } | undefined
  )?.canonical_id;
}

export function registerMapping(db: DatabaseSync, input: unknown) {
  const value = mappingSchema.parse(input);
  const table = value.entity === "hall" ? "halls" : "machines";
  if (!db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(value.canonical_id))
    throw new Error("対応先が登録されていません");
  const alias =
    value.entity === "hall"
      ? normalizeHall(value.alias)
      : normalizeMachine(value.alias);
  if (!alias) throw new Error("有効な別名が必要です");
  const existing = mappedIdentity(db, value.provider_id, value.entity, alias);
  if (existing && existing !== value.canonical_id)
    throw new Error("別の対応先に登録済みです。自動的に統合しません");
  db.prepare(
    "INSERT OR IGNORE INTO source_identity_mappings(provider_id,entity,alias,canonical_id,evidence,created_at) VALUES(?,?,?,?,?,?)",
  ).run(
    value.provider_id,
    value.entity,
    alias,
    value.canonical_id,
    value.evidence,
    new Date().toISOString(),
  );
  return { ...value, alias };
}
