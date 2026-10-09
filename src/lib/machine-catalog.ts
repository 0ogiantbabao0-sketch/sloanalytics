import type { DatabaseSync } from "node:sqlite";
import { normalizeMachine } from "./calendar";
// Short names are an explicit MVP dictionary, not fuzzy matching across generations.
export const initialMachines = [
  ["kabaneri", "L カバネリ 海門決戦", ["カバネリ", "Lカバネリ海門決戦"]],
  ["juggler", "マイジャグラーV", ["マイジャグ", "マイジャグラーⅤ"]],
  ["hokuto", "スマスロ北斗の拳", ["北斗", "北斗の拳"]],
  ["monkey", "スマスロ モンキーターンV", ["モンキーターン", "モンキー"]],
] as const;
export function seedMachineCatalog(db: DatabaseSync) {
  for (const [id, name, aliases] of initialMachines) {
    db.prepare("INSERT OR IGNORE INTO machines(id,name) VALUES(?,?)").run(
      id,
      name,
    );
    const existing = db
      .prepare("SELECT id FROM machines WHERE name=?")
      .get(name) as { id: string };
    for (const alias of new Set([name, ...aliases].map(normalizeMachine)))
      db.prepare(
        "INSERT OR IGNORE INTO machine_aliases(alias,machine_id) VALUES(?,?)",
      ).run(alias, existing.id);
  }
}
