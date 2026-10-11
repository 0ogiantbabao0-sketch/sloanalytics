import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { createDb } from "../src/lib/db";
import { stageCsv, getFile } from "../src/lib/csv-files";
import {
  previewCsv,
  commitCsv,
  numeric,
  dateValue,
} from "../src/lib/csv-workspace";
import { saveSource, assertAutomaticAllowed } from "../src/lib/managed-sources";
import { registerMapping } from "../src/lib/identities";
import { emptyConditions, addDays } from "../src/lib/calendar";
import { search } from "../src/lib/analytics";
import { summarize } from "../src/lib/metrics";
import type { ImportKind } from "../src/lib/csv-dictionary";
import type { Search, Result } from "../src/lib/types";
import { setWeights, defaultWeights } from "../src/lib/scoring";
import { backtest } from "../src/lib/backtest";
import { createSession, validSession } from "../src/lib/owner-session";
const source = (id = "min-repo") => ({
  id,
  name: `DEMO ${id}`,
  url: "https://example.com/demo",
  category: "DEMO",
  method: "csv" as const,
  enabled: true,
  priority: 100,
  storageAllowed: true,
  autoAllowed: false,
  permission: "DEMOテストデータ・合成",
  checkedAt: "2026-10-01",
  frequency: "手動",
});
function setup() {
  const dir = mkdtempSync("/tmp/csv-workspace-");
  process.env.DATA_DIR = dir;
  const db = createDb(":memory:");
  saveSource(db, source());
  return {
    db,
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const halls =
  "data_kind,hall_id,hall_name,address,lat,lng,source_url\ndemo,h1,テスト京都店,京都府・架空,35,135,https://example.com/demo\n";
async function upload(
  db: ReturnType<typeof createDb>,
  text: string | Buffer,
  kind: ImportKind = "results",
  provider = "min-repo",
) {
  return stageCsv(
    db,
    new Blob([
      new Uint8Array(Buffer.isBuffer(text) ? text : Buffer.from(text)),
    ]).stream(),
    { source: provider, kind, filename: "日本語ファイル.csv", mode: "demo" },
  );
}
async function run(
  db: ReturnType<typeof createDb>,
  text: string | Buffer,
  kind: ImportKind = "results",
  provider = "min-repo",
) {
  const f = await upload(db, text, kind, provider);
  const counts = previewCsv(db, f.id, "demo", {
    mapping: f.mapping,
    defaults: {},
    definition: "DEMO・差枚は払出−投入・平均G",
    confirmed: true,
    saveMapping: true,
  });
  const result = commitCsv(db, f.id, "demo", true);
  return { f, counts, result };
}
const header =
  "data_kind,hall_id,machine_name,date,units,avg_diff,total_diff,positive_units,games,source_url\n";
const row = (date: string, avg = 100) =>
  `demo,h1,マイジャグラーV,${date},10,${avg},,5,3000,https://example.com/demo\n`;
const query: Search = {
  mode: "demo",
  center: { name: "DEMO", lat: 35, lng: 135 },
  radius: 50,
  transport: "both",
  targetDate: "2026-10-10",
  targetEnd: "",
  days: 180,
  from: "",
  to: "",
  conditions: { ...emptyConditions },
  rankingMode: "auto",
  machineIds: [],
  hallId: "",
  bestOnly: false,
  sort: "score",
  comparePrevious: false,
};
test("UTF-8 BOM and CP932/semicolon import Japanese halls, preserve original file and hash", async () => {
  const x = setup();
  try {
    let r = await run(x.db, "\ufeff" + halls, "halls");
    assert.equal(r.result.inserted, 1);
    const f = getFile(x.db, r.f.id);
    assert.equal(readFileSync(f.path, "utf8"), "\ufeff" + halls);
    assert.match(f.sha256, /^[0-9a-f]{64}$/);
    r = await run(
      x.db,
      readFileSync("tests/fixtures/halls-cp932.csv"),
      "halls",
    );
    assert.equal(r.f.encoding, "shift_jis");
    assert.equal(r.f.delimiter, ";");
    assert.equal(r.result.inserted, 1);
    assert.equal(
      x.db.prepare("SELECT name FROM halls WHERE id='cp932'").get()!.name,
      "日本語店舗（DEMO）",
    );
  } finally {
    x.close();
  }
});
test("TSV reordered Japanese columns, average-only null total, reused mapping and changed header detection", async () => {
  const x = setup();
  try {
    await run(x.db, halls, "halls");
    const csv =
      "平均差枚\t店舗ID\tデータ種別\t機種\t営業日\t台数\t平均G数\t出典URL\n＋１，２５０\th1\tdemo\tマイジャグラーⅤ\t2026年9月1日\t10\t3000\thttps://example.com/demo\n";
    const r = await run(x.db, csv);
    assert.equal(r.result.inserted, 1);
    const actual = x.db.prepare("SELECT * FROM daily_machine_results").get()!;
    assert.equal(actual.avg_diff, 1250);
    assert.equal(actual.total_diff, null);
    assert.equal(actual.machine_id, "juggler");
    assert.equal(actual.date, "2026-09-01");
    const again = await run(x.db, csv);
    assert.equal(again.result.duplicate, 1);
    assert.equal(
      x.db.prepare("SELECT count(*) n FROM daily_machine_results").get()!.n,
      1,
    );
    assert.equal(
      (await upload(x.db, header + row("2026-09-02"))).formatChanged,
      true,
    );
  } finally {
    x.close();
  }
});
test("partial import rejects invalid dates, blanks and positive counts while valid rows commit; mode separation", async () => {
  const x = setup();
  try {
    await run(x.db, halls, "halls");
    const r = await run(
      x.db,
      header +
        row("2026-09-01") +
        row("2026-02-30") +
        row("2026-09-02").replace(",100,", ",,") +
        row("2026-09-03").replace(",5,3000", ",11,3000") +
        row("2026-09-04").replace("demo,", "real,"),
    );
    assert.equal(r.counts.invalid, 4);
    assert.equal(r.result.inserted, 1);
    assert.equal(r.result.excluded, 4);
    assert.equal(
      x.db.prepare("SELECT count(*) n FROM daily_machine_results").get()!.n,
      1,
    );
  } finally {
    x.close();
  }
});
test("name aliases scoped to provider, IDs prevent merging different models, installations validity", async () => {
  const x = setup();
  try {
    await run(x.db, halls, "halls");
    registerMapping(x.db, {
      provider_id: "min-repo",
      entity: "hall",
      alias: "テスト京都別名",
      canonical_id: "h1",
      evidence: "DEMO住所確認",
    });
    const f = await upload(
      x.db,
      "data_kind,hall_name,machine_name,units,survey_date,valid_to,source_url\ndemo,テスト京都別名,マイジャグラーⅤ,12,2026/9/1,2026/9/30,https://example.com/demo\n",
      "installations",
    );
    const c = previewCsv(x.db, f.id, "demo", {
      mapping: f.mapping,
      defaults: {},
      definition: "DEMO設置調査",
      confirmed: true,
      saveMapping: false,
    });
    assert.equal(c.invalid, 0);
    assert.equal(commitCsv(x.db, f.id, "demo", true).inserted, 1);
    assert.equal(
      x.db.prepare("SELECT valid_from FROM hall_machine_installations").get()!
        .valid_from,
      "2026-09-01",
    );
  } finally {
    x.close();
  }
});
test("two sources are retained, inconsistent values excluded from scores without double count", async () => {
  const x = setup();
  try {
    await run(x.db, halls, "halls");
    const csv =
      header +
      Array.from({ length: 10 }, (_, i) =>
        row(`2026-09-${String(i + 1).padStart(2, "0")}`, 100 + i * 10),
      ).join("");
    await run(x.db, csv);
    const before = search(x.db, query);
    assert.ok(before.rankings[0].score !== null);
    saveSource(x.db, source("ana-slo"));
    const other = await run(
      x.db,
      header + row("2026-09-01", 500),
      "results",
      "ana-slo",
    );
    assert.equal(other.result.retained, 1);
    assert.equal(
      x.db
        .prepare(
          "SELECT avg_diff FROM daily_machine_results WHERE date='2026-09-01'",
        )
        .get()!.avg_diff,
      100,
    );
    const after = search(x.db, query);
    assert.equal(after.rankings[0].days, 9);
    assert.match(after.warning!, /競合1件/);
    assert.equal(
      x.db.prepare("SELECT count(*) n FROM daily_machine_results").get()!.n,
      10,
    );
  } finally {
    x.close();
  }
});
test("unapproved automation blocked, malformed settings fail and new source is usable", async () => {
  const x = setup();
  try {
    assert.throws(() => assertAutomaticAllowed(x.db, "min-repo"), /許可/);
    assert.throws(
      () => saveSource(x.db, { ...source(), method: "automatic" }),
      /自動/,
    );
    saveSource(x.db, source("custom-csv"));
    assert.equal(
      (await run(x.db, halls, "halls", "custom-csv")).result.inserted,
      1,
    );
    saveSource(x.db, {
      ...source("approved"),
      method: "automatic",
      autoAllowed: true,
    });
    assert.throws(() => assertAutomaticAllowed(x.db, "approved"), /Phase 3/);
  } finally {
    x.close();
  }
});
test("format corrections preserve nulls, inconsistent averages never silently repaired", async () => {
  assert.equal(numeric("−８５０"), -850);
  assert.equal(numeric("N/A"), null);
  assert.equal(numeric("５５％", true), 55);
  assert.throws(() => numeric("1,2"));
  assert.equal(dateValue("2026/1/2"), "2026-01-02");
  const x = setup();
  try {
    await run(x.db, halls, "halls");
    const r = await run(
      x.db,
      header + row("2026-09-01").replace(",100,,", ",100,5000,"),
    );
    assert.equal(r.counts.review, 1);
    assert.equal(r.result.inserted, 0);
  } finally {
    x.close();
  }
});
test("preview cannot commit after permissions revoked; repeats are idempotent", async () => {
  const x = setup();
  try {
    await run(x.db, halls, "halls");
    const f = await upload(x.db, header + row("2026-09-01"));
    previewCsv(x.db, f.id, "demo", {
      mapping: f.mapping,
      defaults: {},
      definition: "DEMO",
      confirmed: true,
      saveMapping: false,
    });
    saveSource(x.db, { ...source(), storageAllowed: false });
    assert.throws(() => commitCsv(x.db, f.id, "demo", true), /許可/);
    saveSource(x.db, source());
    const a = commitCsv(x.db, f.id, "demo", true);
    assert.deepEqual(commitCsv(x.db, f.id, "demo", true), a);
  } finally {
    x.close();
  }
});
test("large CSV streams past previous 10000 row limit and commits without truncation", async () => {
  const x = setup();
  try {
    await run(x.db, halls, "halls");
    const count = 10001;
    const text =
      header +
      Array.from({ length: count }, (_, i) =>
        row(addDays("1980-01-01", i)),
      ).join("");
    const r = await run(x.db, text);
    assert.equal(r.f.count, count);
    assert.equal(r.result.inserted, count);
    assert.equal(
      x.db.prepare("SELECT count(*) n FROM daily_machine_results").get()!.n,
      count,
    );
  } finally {
    x.close();
  }
});
test("weighted average retains rounded averages but does not invent total", () => {
  const rows = [
    {
      units: 2,
      total_diff: null,
      avg_diff: 10,
      positive_units: null,
      games: null,
    },
    {
      units: 8,
      total_diff: 160,
      avg_diff: null,
      positive_units: 4,
      games: 1000,
    },
  ] as Result[];
  const r = summarize(rows);
  assert.equal(r.avg, 18);
  assert.equal(r.total, null);
});
test("scores update after import/correction, date conditions and modes work, no future leakage", async () => {
  const x = setup();
  try {
    await run(x.db, halls, "halls");
    await run(
      x.db,
      header +
        Array.from({ length: 30 }, (_, i) =>
          row(addDays("2026-09-01", i), i % 7 === 0 ? 500 : -100),
        ).join(""),
    );
    const a = search(x.db, query, { audit: true });
    search(x.db, query, { audit: true });
    assert.equal(
      x.db.prepare("SELECT COUNT(*) AS n FROM score_runs").get()!.n,
      1,
    );
    assert.ok(a.rankings[0].scoreDetail);
    assert.ok(a.rankings[0].hallScore !== null);
    const limited = search(x.db, {
      ...query,
      conditions: { ...emptyConditions, monthDays: [1] },
    });
    assert.equal(limited.rankings[0].score, null);
    assert.equal(
      search(x.db, { ...query, rankingMode: "machine", machineIds: ["hokuto"] })
        .rankings.length,
      0,
    );
    const history = search(x.db, { ...query, targetDate: "2026-09-20" });
    await run(x.db, header + row("2026-09-30", 100000));
    assert.equal(
      search(x.db, { ...query, targetDate: "2026-09-20" }).rankings[0].score,
      history.rankings[0].score,
    );
    assert.notEqual(
      search(x.db, query).rankings[0].scoreDetail!.dataVersion,
      a.rankings[0].scoreDetail!.dataVersion,
    );
    setWeights(x.db, {
      ...defaultWeights,
      machine: 100,
      stability: 0,
      recent: 0,
      hall: 0,
      event: 0,
    });
    assert.equal(
      search(x.db, query).rankings[0].scoreDetail!.weights.machine,
      100,
    );
    assert.throws(
      () => setWeights(x.db, { ...defaultWeights, machine: 99 }),
      /100/,
    );
    const b = backtest(x.db, query, "2026-09-15", "2026-09-20");
    assert.equal(b.windows, 6);
    assert.ok(b.count > 0);
    assert.ok(b.predictions.every((p) => p.date <= "2026-09-20"));
    assert.equal(backtest(x.db, query, "2024-01-01", "2024-01-03").count, 0);
  } finally {
    x.close();
  }
});
test("owner session signatures expire and cannot be forged or reused after password rotation", async () => {
  process.env.OWNER_SESSION_SECRET = "test-only-secret-".repeat(4);
  process.env.OWNER_PASSWORD = "test-only-password";
  const token = await createSession();
  assert.equal(await validSession(token), true);
  assert.equal(
    await validSession(token.slice(0, -1) + (token.endsWith("0") ? "1" : "0")),
    false,
  );
  assert.equal(await validSession("1000000000." + token.split(".")[1]), false);
  process.env.OWNER_PASSWORD = "changed-test-password";
  assert.equal(await validSession(token), false);
  delete process.env.OWNER_PASSWORD;
  delete process.env.OWNER_SESSION_SECRET;
});
