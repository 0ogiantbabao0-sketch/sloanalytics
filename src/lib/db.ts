import { seedMachineCatalog } from "./machine-catalog";
import { migrateSources } from "./migrations";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
export type DataMode = "demo" | "real";
const connections = new Map<string, DatabaseSync>();
export function createDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    db.exec(readFileSync(resolve(process.cwd(), "src/lib/schema.sql"), "utf8"));
    migrateSources(db);
    seedMachineCatalog(db);
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}
export function getDb(mode: DataMode): DatabaseSync {
  const dir = resolve(process.env.DATA_DIR || "./data");
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${mode}.sqlite`);
  if (!connections.has(path)) connections.set(path, createDb(path));
  return connections.get(path)!;
}
export function all<T>(
  db: DatabaseSync,
  sql: string,
  ...params: SQLInputValue[]
): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}
export function one<T>(
  db: DatabaseSync,
  sql: string,
  ...params: SQLInputValue[]
): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}
