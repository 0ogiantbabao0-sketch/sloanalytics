import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createDb } from "../src/lib/db";
import {
  importRecords,
  importCsv,
  selectObservation,
  CSV_HEADER,
} from "../src/lib/importer";
import { registerMapping } from "../src/lib/identities";
import {
  PermittedCsvAdapter,
  runAdapters,
  runAdapter,
  adapterConfigSchema,
  type AdapterConfig,
  type DataAdapter,
} from "../src/lib/adapters";
import {
  DEFINITION_CODE,
  STANDARD_DEFINITION,
} from "../src/lib/source-catalog";

const row = (extra: Record<string, unknown> = {}) => ({
  data_kind: "real",
  hall_id: "hall-a",
  hall_name: "検証ホールＡ",
  address: "京都府",
  lat: "34.924",
  lng: "135.701",
  machine_name: "カバネリ",
  date: "2026-10-01",
  units: "10",
  total_diff: "1000",
  positive_units: "6",
  games: "5000",
  source_name: "許諾済み提供者A",
  source_url: "https://example.com/a",
  permission: "テスト契約",
  ...extra,
});
const csv = (value = row()) =>
  CSV_HEADER +
  "\n" +
  CSV_HEADER.split(",")
    .map((key) => value[key as keyof typeof value])
    .join(",");
const useDb = (fn: (db: DatabaseSync) => void) => {
  const db = createDb(":memory:");
  try {
    fn(db);
  } finally {
    db.close();
  }
};
function get<T>(db: DatabaseSync, sql: string) {
  return db.prepare(sql).get() as T;
}

test("two providers retain independent observations without double counting; selection is audited", () =>
  useDb((db) => {
    importRecords(db, [row()], "real");
    const second = importRecords(
      db,
      [
        row({
          provider_id: "min-repo",
          source_name: "許諾済み提供者B",
          source_url: "https://example.com/b",
          total_diff: "2000",
        }),
      ],
      "real",
    );
    assert.equal(second.changed, 0);
    assert.equal(second.retained, 1);
    assert.equal(
      get<{ n: number }>(db, "SELECT count(*) AS n FROM source_observations").n,
      2,
    );
    assert.equal(
      get<{ n: number }>(db, "SELECT count(*) AS n FROM daily_machine_results")
        .n,
      1,
    );
    assert.equal(
      get<{ total_diff: number }>(
        db,
        "SELECT total_diff FROM daily_machine_results",
      ).total_diff,
      1000,
    );
    const other = get<{ id: number }>(
      db,
      "SELECT id FROM source_observations WHERE provider_id='min-repo'",
    );
    selectObservation(db, other.id);
    assert.equal(
      get<{ total_diff: number }>(
        db,
        "SELECT total_diff FROM daily_machine_results",
      ).total_diff,
      2000,
    );
    assert.equal(
      get<{ n: number }>(db, "SELECT count(*) AS n FROM data_revisions").n,
      2,
    );
    // Reimporting the unselected provider never steals selection.
    importRecords(db, [row({ total_diff: "3000" })], "real");
    assert.equal(
      get<{ total_diff: number }>(
        db,
        "SELECT total_diff FROM daily_machine_results",
      ).total_diff,
      2000,
    );
    assert.equal(
      get<{ n: number }>(db, "SELECT count(*) AS n FROM source_observations").n,
      2,
    );
  }));

test("acquisition receipts preserve original dates, definitions, aliases and corrections", () =>
  useDb((db) => {
    importRecords(
      db,
      [
        row({
          retrieved_at: "2026-10-02T10:00:00+09:00",
          published_at: "2026-10-02T09:00:00+09:00",
          source_updated_at: "2026-10-02T09:30:00+09:00",
        }),
      ],
      "real",
    );
    importRecords(
      db,
      [row({ retrieved_at: "2026-10-03T10:00:00+09:00", total_diff: "2000" })],
      "real",
    );
    const receipt = JSON.parse(
      get<{ after_json: string }>(
        db,
        "SELECT after_json FROM observation_revisions ORDER BY id LIMIT 1",
      ).after_json,
    );
    assert.equal(receipt.retrieved_at, "2026-10-02T10:00:00+09:00");
    assert.equal(receipt.published_at, "2026-10-02T09:00:00+09:00");
    assert.equal(receipt.raw_machine_name, "カバネリ");
    assert.equal(receipt.definition, STANDARD_DEFINITION);
    assert.equal(receipt.method, "manual");
    assert.equal(JSON.parse(receipt.payload_json).total_diff, 1000);
    assert.equal(
      get<{ total_diff: number }>(
        db,
        "SELECT total_diff FROM daily_machine_results",
      ).total_diff,
      2000,
    );
  }));

test("hall width/spacing variations match, explicit source aliases do not leak to other sources", () =>
  useDb((db) => {
    importRecords(db, [row()], "real");
    importRecords(db, [row({ hall_name: " 検証 ホールA " })], "real");
    assert.throws(
      () => importRecords(db, [row({ hall_name: "別名" })], "real"),
      /別名/,
    );
    registerMapping(db, {
      provider_id: "min-repo",
      entity: "hall",
      alias: "別名",
      canonical_id: "hall-a",
      evidence: "同一住所・公式店舗IDの確認",
    });
    importRecords(
      db,
      [row({ provider_id: "min-repo", hall_name: "別名" })],
      "real",
    );
    assert.throws(
      () =>
        importRecords(
          db,
          [row({ provider_id: "ana-slo", hall_name: "別名" })],
          "real",
        ),
      /別名/,
    );
    assert.throws(
      () =>
        importRecords(
          db,
          [
            row({
              provider_id: "min-repo",
              hall_name: "別名",
              address: "別住所",
            }),
          ],
          "real",
        ),
      /住所/,
    );
    assert.throws(
      () =>
        importRecords(
          db,
          [
            row({
              provider_id: "min-repo",
              hall_name: "別名",
              hall_id: "other",
            }),
          ],
          "real",
        ),
      /一致/,
    );
  }));

test("source machine aliases are explicit and scoped; remapping cannot silently merge generations", () =>
  useDb((db) => {
    registerMapping(db, {
      provider_id: "ana-slo",
      entity: "machine",
      alias: "提供者の略称",
      canonical_id: "kabaneri",
      evidence: "型式確認",
    });
    importRecords(
      db,
      [row({ provider_id: "ana-slo", machine_name: "提供者の略称" })],
      "real",
    );
    assert.equal(
      get<{ machine_id: string }>(
        db,
        "SELECT machine_id FROM daily_machine_results",
      ).machine_id,
      "kabaneri",
    );
    assert.throws(
      () =>
        registerMapping(db, {
          provider_id: "ana-slo",
          entity: "machine",
          alias: "提供者の略称",
          canonical_id: "hokuto",
          evidence: "別世代",
        }),
      /登録済み/,
    );
    importRecords(
      db,
      [row({ provider_id: "min-repo", machine_name: "提供者の略称" })],
      "real",
    );
    assert.equal(
      get<{ n: number }>(
        db,
        "SELECT count(*) AS n FROM machines WHERE name='提供者の略称'",
      ).n,
      1,
    );
  }));

test("invalid definitions, permissions, timestamps and mixed demo data roll back", () =>
  useDb((db) => {
    for (const extra of [
      { definition_code: "games-total" },
      { permission: "" },
      { retrieved_at: "not-a-date" },
      { data_kind: "demo" },
      { provider_id: "unknown" },
      { source_url: "https://secret@example.com/data" },
    ]) {
      assert.throws(() =>
        importRecords(
          db,
          [row(), row({ date: "2026-10-02", ...extra })],
          "real",
        ),
      );
    }
    assert.equal(
      get<{ n: number }>(db, "SELECT count(*) AS n FROM halls").n,
      0,
    );
    assert.equal(
      get<{ n: number }>(db, "SELECT count(*) AS n FROM source_observations").n,
      0,
    );
    assert.equal(
      get<{ n: number }>(
        db,
        "SELECT count(*) AS n FROM import_jobs WHERE status='failed'",
      ).n,
      6,
    );
  }));

test("CSV keeps old format and rejects duplicate headers and duplicate normalized identities", () =>
  useDb((db) => {
    assert.equal(importCsv(db, csv(), "real").changed, 1);
    assert.equal(importCsv(db, csv(), "real").changed, 0);
    assert.throws(
      () => importCsv(db, csv().replace("hall_name,", "hall_id,"), "real"),
      /ヘッダー/,
    );
    assert.throws(
      () =>
        importRecords(
          db,
          [row(), row({ machine_name: "L カバネリ 海門決戦" })],
          "real",
        ),
      /重複/,
    );
  }));

test("v1 migration preserves existing rows and repeated opens do not reset the version", () => {
  const dir = mkdtempSync("/tmp/slot-migration-");
  const path = `${dir}/old.sqlite`;
  try {
    const old = new DatabaseSync(path);
    old.exec(readFileSync("src/lib/schema.sql", "utf8"));
    old.exec(
      "INSERT INTO halls(id,name) VALUES('kept','保持店舗'); PRAGMA user_version=1;",
    );
    old.close();
    for (let i = 0; i < 2; i++) {
      const db = createDb(path);
      try {
        assert.equal(
          get<{ user_version: number }>(db, "PRAGMA user_version").user_version,
          3,
        );
        assert.equal(
          get<{ name: string }>(db, "SELECT name FROM halls WHERE id='kept'")
            .name,
          "保持店舗",
        );
        assert.equal(
          get<{ n: number }>(
            db,
            "SELECT count(*) AS n FROM source_observations",
          ).n,
          0,
        );
      } finally {
        db.close();
      }
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

const config = (patch: Partial<AdapterConfig> = {}): AdapterConfig => ({
  id: "test",
  providerId: "user",
  url: "https://example.com/data.csv",
  allowedHost: "example.com",
  permission: {
    status: "approved",
    reference: "テスト契約",
    automatedRetrieval: true,
    redistribution: true,
    checkedAt: new Date(Date.now() - 86400000).toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    minimumIntervalSeconds: 60,
  },
  ...patch,
});

test("no unapproved, expired, redirecting or mismatched-host network request is allowed", async (t) => {
  const db = createDb(":memory:");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("redirect refused");
  });
  try {
    assert.equal(
      adapterConfigSchema.safeParse({
        ...config(),
        permission: { ...config().permission, automatedRetrieval: false },
      }).success,
      false,
    );
    await assert.rejects(
      runAdapter(
        db,
        new PermittedCsvAdapter(
          config({ url: "https://elsewhere.example/data.csv" }),
        ),
      ),
      /HTTPS/,
    );
    await assert.rejects(
      runAdapter(
        db,
        new PermittedCsvAdapter(
          config({
            permission: {
              ...config().permission,
              expiresAt: "2000-01-01T00:00:00Z",
            },
          }),
        ),
      ),
      /有効期限/,
    );
    assert.equal(calls, 0);
    await assert.rejects(
      new PermittedCsvAdapter(config()).fetchCsv(),
      /リダイレクト/,
    );
    assert.equal(calls, 1);
  } finally {
    db.close();
  }
});

test("licensed CSV uses exact host, TLS default, redirect rejection, limits and permission metadata", async (t) => {
  const db = createDb(":memory:");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: URL, init: RequestInit) => {
    calls++;
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);
    return new Response(csv());
  });
  try {
    await runAdapter(db, new PermittedCsvAdapter(config()));
    assert.equal(
      get<{ method: string }>(db, "SELECT method FROM source_observations")
        .method,
      "licensed-csv",
    );
    await assert.rejects(
      runAdapter(db, new PermittedCsvAdapter(config())),
      /取得間隔/,
    );
    assert.equal(calls, 1);
  } finally {
    db.close();
  }
});

test("oversized network payloads are rejected before ingestion", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("a".repeat(2_000_001)),
  );
  await assert.rejects(new PermittedCsvAdapter(config()).fetchCsv(), /2MB/);
});

test("independent adapters continue after failure and mismatched provider never imports", async () => {
  const db = createDb(":memory:");
  const adapter = (
    name: string,
    providerId: string,
    fail = false,
  ): DataAdapter => ({
    name,
    context: { method: "licensed-csv", providerId },
    validate() {},
    async fetchCsv() {
      if (fail) throw new Error("failure");
      return csv();
    },
  });
  try {
    const results = await runAdapters(db, [
      adapter("broken", "user", true),
      adapter("mismatch", "min-repo"),
      adapter("working", "user"),
    ]);
    assert.deepEqual(
      results.map((r) => r.ok),
      [false, false, true],
    );
    assert.equal(
      get<{ n: number }>(db, "SELECT count(*) AS n FROM daily_machine_results")
        .n,
      1,
    );
    assert.equal(
      get<{ n: number }>(
        db,
        "SELECT count(*) AS n FROM import_jobs WHERE status='failed'",
      ).n,
      2,
    );
  } finally {
    db.close();
  }
});

test("legacy CSV source identity remains compatible with corrections after upgrade", () =>
  useDb((db) => {
    importCsv(db, csv(), "real");
    // A v1 database already had sources and adopted results, but no observation tables.
    db.exec(
      "DELETE FROM observation_revisions; DELETE FROM source_observations;",
    );
    const selected = get<{ source_id: string }>(
      db,
      "SELECT source_id FROM daily_machine_results",
    ).source_id;
    assert.equal(selected.length, 18); // v1 s- prefix + 16 hex characters
    const result = importCsv(db, csv(row({ total_diff: "2500" })), "real");
    assert.equal(result.changed, 1);
    assert.equal(result.retained, 0);
    assert.equal(
      get<{ source_id: string }>(
        db,
        "SELECT source_id FROM daily_machine_results",
      ).source_id,
      selected,
    );
    assert.equal(
      get<{ total_diff: number }>(
        db,
        "SELECT total_diff FROM daily_machine_results",
      ).total_diff,
      2500,
    );
  }));
