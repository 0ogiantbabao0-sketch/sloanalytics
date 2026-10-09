import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  emptyConditions,
  haversine,
  holidayName,
  holidayStreak,
  isDouble,
  matchesDate,
  normalizeMachine,
  validDate,
} from "../src/lib/calendar";
import { evaluate, search } from "../src/lib/analytics";
import { summarize } from "../src/lib/metrics";
import { createDb } from "../src/lib/db";
import { importCsv, CSV_HEADER } from "../src/lib/importer";
import { searchSchema } from "../src/lib/search-schema";
import type { Result, Search } from "../src/lib/types";
const row = (date: string, avg = 300, extra: Partial<Result> = {}): Result => ({
  hall_id: "a",
  machine_id: "m",
  date,
  total_diff: avg * 10,
  units: 10,
  positive_units: 6,
  games: 5000,
  source_id: "s",
  updated_at: "2026-10-10T00:00:00Z",
  ...extra,
});
const sampleCsv = (rows = 3, kind = "real") =>
  CSV_HEADER +
  "\n" +
  Array.from(
    { length: rows },
    (_, i) =>
      `${kind},hall-a,検証店舗,京都府,34.924,135.701,カバネリ,2026-10-${String(i + 1).padStart(2, "0")},10,${1000 + i * 100},6,5000,許諾元,https://example.com/data,テスト用許諾済み`,
  ).join("\n");
const input: Search = {
  mode: "real",
  center: { name: "長岡京駅", lat: 34.9237, lng: 135.7001 },
  radius: 30,
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
test("Japan holidays, substitute holiday and citizens holiday", () => {
  assert.equal(holidayName("2026-10-12"), "スポーツの日");
  assert.ok(holidayName("2026-05-06"));
  assert.ok(holidayName("2026-09-22"));
  assert.equal(holidayName("2026-10-09"), null);
});
test("three day weekend 2026-10-10 to 12 has correct positions", () => {
  for (const [d, p, i] of [
    ["2026-10-10", "first", 1],
    ["2026-10-11", "middle", 2],
    ["2026-10-12", "last", 3],
  ] as const) {
    const h = holidayStreak(d);
    assert.equal(h.length, 3);
    assert.equal(h.position, p);
    assert.equal(h.index, i);
  }
  assert.equal(holidayStreak("2026-10-09").length, 0);
});
test("five-day holiday and end-day filtering", () => {
  assert.equal(holidayStreak("2026-05-06").length, 5);
  assert.ok(
    matchesDate("2026-10-12", {
      ...emptyConditions,
      minStreak: 3,
      streakPosition: "last",
    }),
  );
  assert.equal(
    matchesDate("2026-10-11", {
      ...emptyConditions,
      minStreak: 3,
      streakPosition: "last",
    }),
    false,
  );
});
test("digits and exact monthly date are distinct", () => {
  assert.ok(matchesDate("2026-10-21", { ...emptyConditions, digits: [1] }));
  assert.equal(
    matchesDate("2026-10-21", { ...emptyConditions, monthDays: [11] }),
    false,
  );
  assert.ok(matchesDate("2026-10-11", { ...emptyConditions, monthDays: [11] }));
});
test("double dates have documented semantics", () => {
  assert.ok(isDouble("2026-10-10"));
  assert.ok(isDouble("2026-10-22"));
  assert.equal(isDouble("2026-10-12"), false);
});
test("AND/OR across groups and no filters", () => {
  const c = { ...emptyConditions, digits: [0], weekdays: [0] };
  assert.equal(matchesDate("2026-10-10", c), false);
  assert.ok(matchesDate("2026-10-10", { ...c, join: "OR" }));
  assert.ok(matchesDate("2026-10-10", emptyConditions));
});
test("events and special days use explicit context", () => {
  const c = { ...emptyConditions, eventType: "visit", eventText: "ゲスト" };
  assert.equal(matchesDate("2026-10-10", c), false);
  assert.ok(
    matchesDate("2026-10-10", c, {
      special: false,
      events: [{ type: "visit", name: "来店", performer: "ゲスト" }],
    }),
  );
});
test("Haversine distance rejects far halls by numeric radius", () => {
  const a = { lat: 34.9237, lng: 135.7001 };
  assert.equal(haversine(a, a), 0);
  assert.ok(haversine(a, { lat: 34.9858, lng: 135.7588 }) < 10);
  assert.ok(haversine(a, { lat: 34.7055, lng: 135.4983 }) > 30);
  assert.ok(haversine(a, { lat: 34.7055, lng: 135.4983 }) < 31);
  assert.ok(haversine(a, { lat: 35.68, lng: 139.76 }) > 300);
});
test("normalization handles width, roman numeral V, spaces and separators", () => {
  assert.equal(
    normalizeMachine(" マイジャグラーⅤ "),
    normalizeMachine("マイジャグラーV"),
  );
  assert.equal(
    normalizeMachine("Ｌ カバネリ・海門決戦"),
    normalizeMachine("Lカバネリ海門決戦"),
  );
});
test("real dates and leap days validated", () => {
  assert.equal(validDate("2026-02-30"), false);
  assert.ok(validDate("2024-02-29"));
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});
test("store total, weighted machine average and plus rate", () => {
  const s = summarize([
    row("2026-10-01", 100),
    row("2026-10-02", 300, { units: 20, total_diff: 6000, positive_units: 8 }),
  ]);
  assert.equal(s.total, 7000);
  assert.equal(s.avg, 7000 / 30);
  assert.equal(s.positiveRate, (14 / 30) * 100);
});
test("missing data stays null, not zero", () => {
  const s = summarize([
    row("2026-10-01", 100, { positive_units: null, games: null }),
  ]);
  assert.equal(s.positiveRate, null);
  assert.equal(s.games, null);
  const e = evaluate([row("2026-10-01")], [], "2026-10-10");
  assert.equal(e.score, null);
  assert.equal(e.baseline, null);
});
test("score bounds and small sample shrinkage", () => {
  const baseline = Array.from({ length: 30 }, (_, i) =>
    row(addDays("2026-09-01", i), 0),
  );
  const small = Array.from({ length: 3 }, (_, i) =>
    row(addDays("2026-10-01", i), 500),
  );
  const large = Array.from({ length: 30 }, (_, i) =>
    row(addDays("2026-09-04", i), 500),
  );
  const s = evaluate(small, baseline, "2026-10-10"),
    l = evaluate(large, baseline, "2026-10-10");
  assert.ok(s.score !== null && l.score !== null && s.score < l.score);
  assert.ok(l.score! >= 0 && l.score! <= 100);
  assert.ok(s.confidence < l.confidence);
  assert.equal(evaluate(small.slice(0, 2), baseline, "2026-10-10").score, null);
});
test("same-machine baseline makes equal standardized lifts comparable", () => {
  const mk = (offset: number) =>
    Array.from({ length: 8 }, (_, i) => row(addDays("2026-10-01", i), offset));
  assert.equal(
    evaluate(mk(300), mk(0), "2026-10-10").score,
    evaluate(mk(1300), mk(1000), "2026-10-10").score,
  );
});
test("CSV import persists, normalizes aliases and is idempotent", () => {
  const db = createDb(":memory:");
  try {
    const a = importCsv(db, sampleCsv(), "real");
    assert.equal(a.changed, 3);
    const b = importCsv(db, sampleCsv(), "real");
    assert.equal(b.changed, 0);
    assert.equal(
      (
        db.prepare("SELECT count(*) AS n FROM daily_machine_results").get() as {
          n: number;
        }
      ).n,
      3,
    );
    assert.equal(
      (
        db.prepare("SELECT count(*) AS n FROM data_revisions").get() as {
          n: number;
        }
      ).n,
      3,
    );
  } finally {
    db.close();
  }
});
test("CSV changes leave revision with original value", () => {
  const db = createDb(":memory:");
  try {
    importCsv(db, sampleCsv(1), "real");
    assert.equal(
      importCsv(db, sampleCsv(1).replace(",1000,", ",2000,"), "real").changed,
      1,
    );
    const rev = db
      .prepare(
        "SELECT before_json FROM data_revisions ORDER BY id DESC LIMIT 1",
      )
      .get() as { before_json: string };
    assert.equal(JSON.parse(rev.before_json).total_diff, 1000);
  } finally {
    db.close();
  }
});
test("duplicate input and invalid counts roll back the whole transaction", () => {
  const db = createDb(":memory:");
  try {
    const csv = sampleCsv(1);
    assert.throws(
      () => importCsv(db, csv + "\n" + csv.split("\n")[1], "real"),
      /重複/,
    );
    assert.equal(
      (db.prepare("SELECT count(*) AS n FROM halls").get() as { n: number }).n,
      0,
    );
    assert.throws(
      () => importCsv(db, csv.replace(",6,5000", ",11,5000"), "real"),
      /プラス台数/,
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT count(*) AS n FROM import_jobs WHERE status='failed'",
          )
          .get() as { n: number }
      ).n,
      2,
    );
  } finally {
    db.close();
  }
});
test("demo and real datasets cannot be mixed", () => {
  const db = createDb(":memory:");
  try {
    assert.throws(
      () => importCsv(db, sampleCsv(3, "demo"), "real"),
      /別の取込先/,
    );
    assert.equal(
      (
        db.prepare("SELECT count(*) AS n FROM daily_machine_results").get() as {
          n: number;
        }
      ).n,
      0,
    );
  } finally {
    db.close();
  }
});
test("missing numeric CSV cells are rejected rather than coerced to zero", () => {
  const db = createDb(":memory:");
  try {
    assert.throws(() =>
      importCsv(db, sampleCsv(1).replace(",1000,", ",,"), "real"),
    );
  } finally {
    db.close();
  }
});
test("search applies dates, mode, radius and no future installation inference", () => {
  const db = createDb(":memory:");
  try {
    importCsv(db, sampleCsv(9), "real");
    const result = search(db, input);
    assert.equal(result.rankings.length, 1);
    assert.equal(result.rankings[0].days, 9);
    assert.equal(result.rankings[0].installation, null);
    assert.equal(
      search(db, { ...input, targetDate: "2026-10-04" }).rankings[0].days,
      3,
    );
    assert.equal(
      search(db, {
        ...input,
        conditions: { ...emptyConditions, monthDays: [11] },
      }).rankings.length,
      0,
    );
    assert.equal(
      search(db, {
        ...input,
        center: { name: "東京", lat: 35.68, lng: 139.76 },
      }).rankings.length,
      0,
    );
    assert.equal(
      search(db, { ...input, rankingMode: "machine", machineIds: ["missing"] })
        .rankings.length,
      0,
    );
  } finally {
    db.close();
  }
});
test("request validation prevents invalid dates and empty selections", () => {
  assert.ok(searchSchema.safeParse(input).success);
  assert.equal(
    searchSchema.safeParse({ ...input, targetDate: "2026-02-30" }).success,
    false,
  );
  assert.equal(
    searchSchema.safeParse({ ...input, rankingMode: "machine" }).success,
    false,
  );
  assert.equal(
    searchSchema.safeParse({ ...input, from: "2026-10-01", to: "2026-10-11" })
      .success,
    false,
  );
});
test("canonical machine name and declared alias resolve to the same stored record", () => {
  const db = createDb(":memory:");
  try {
    importCsv(db, sampleCsv(1), "real");
    const second = importCsv(
      db,
      sampleCsv(1).replace(",カバネリ,", ",L カバネリ 海門決戦,"),
      "real",
    );
    assert.equal(second.changed, 0);
    assert.equal(
      (
        db.prepare("SELECT count(*) AS n FROM daily_machine_results").get() as {
          n: number;
        }
      ).n,
      1,
    );
  } finally {
    db.close();
  }
});
test("baseline requires three distinct dates even when several halls reported one date", () => {
  const current = [row("2026-10-01"), row("2026-10-02"), row("2026-10-03")];
  const baseline = [
    row("2026-09-01", 0, { hall_id: "a" }),
    row("2026-09-01", 0, { hall_id: "b" }),
    row("2026-09-01", 0, { hall_id: "c" }),
  ];
  assert.equal(evaluate(current, baseline, "2026-10-10").score, null);
});
