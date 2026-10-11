import type { DatabaseSync } from "node:sqlite";
import { search } from "./analytics";
import { averageDiff } from "./metrics";
import {
  getWeights,
  defaultWeights,
  type Weights,
  ensureScores,
  scoreVersion,
  sourceConsistency,
} from "./scoring";
import { matchesDate, validDate } from "./calendar";
import type { Search, Result, Event } from "./types";
const average = (v: number[]) =>
  v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
export function backtest(
  db: DatabaseSync,
  input: Search,
  from: string,
  to: string,
  weights: Weights = getWeights(db),
) {
  if (
    !validDate(from) ||
    !validDate(to) ||
    from > to ||
    Date.parse(to) - Date.parse(from) > 90 * 86400000
  )
    throw new Error("検証期間は有効な日付で90日以内にしてください");
  const targets = db
    .prepare(
      "SELECT DISTINCT date FROM daily_machine_results WHERE date BETWEEN ? AND ? ORDER BY date",
    )
    .all(from, to)
    .map((r) => String(r.date));
  if (targets.length > 60)
    throw new Error("検証する営業日は60日以内にしてください");
  const events = db
    .prepare("SELECT * FROM events WHERE status!='cancelled'")
    .all() as unknown as Event[];
  const special = db.prepare("SELECT * FROM special_days").all() as {
    hall_id: string;
    kind: string;
    value: number;
  }[];
  const predictions: {
    date: string;
    hall: string;
    machine: string;
    score: number;
    outcome: number;
    rank: number;
    version: string;
  }[] = [];
  let held = 0;
  for (const date of targets) {
    const response = search(
      db,
      {
        ...input,
        targetDate: date,
        targetEnd: "",
        from: "",
        to: "",
        bestOnly: false,
        sort: "score",
        comparePrevious: false,
      },
      { weights },
    );
    const actual = db
      .prepare("SELECT * FROM daily_machine_results WHERE date=?")
      .all(date) as unknown as Result[];
    const conflicts = sourceConsistency(db, actual);
    let rank = 0;
    for (const r of response.rankings) {
      const row = actual.find(
        (x) => x.hall_id === r.hall.id && x.machine_id === r.machine.id,
      );
      if (!row || conflicts.conflicts.has(conflicts.key(row))) continue;
      if (
        !matchesDate(date, input.conditions, {
          special: special.some(
            (s) =>
              s.hall_id === row.hall_id &&
              s.value ===
                (s.kind === "digit"
                  ? Number(date.slice(-2)) % 10
                  : Number(date.slice(-2))),
          ),
          events: events.filter(
            (e) => e.hall_id === row.hall_id && e.date === date,
          ),
        })
      )
        continue;
      if (r.score === null) {
        held++;
        continue;
      }
      rank++;
      predictions.push({
        date,
        hall: r.hall.id,
        machine: r.machine.id,
        score: r.score,
        outcome: averageDiff(row),
        rank,
        version: r.scoreDetail!.dataVersion,
      });
    }
  }
  const bands = Array.from({ length: 5 }, (_, i) => {
    const low = i * 20,
      high = i === 4 ? 100 : low + 19;
    const rows = predictions.filter((r) => r.score >= low && r.score <= high);
    return {
      band: `${low}–${high}`,
      count: rows.length,
      avg: average(rows.map((r) => r.outcome)),
    };
  });
  const top: number[] = [],
    bottom: number[] = [];
  for (const date of targets) {
    const sorted = predictions
      .filter((p) => p.date === date)
      .sort((a, b) => a.rank - b.rank);
    if (sorted.length < 4) continue;
    const n = Math.max(1, Math.floor(sorted.length / 4));
    top.push(...sorted.slice(0, n).map((p) => p.outcome));
    bottom.push(...sorted.slice(-n).map((p) => p.outcome));
  }
  const topAvg = average(top),
    bottomAvg = average(bottom);
  return {
    from,
    to,
    windows: targets.length,
    count: predictions.length,
    held,
    bands,
    topAvg,
    bottomAvg,
    difference:
      topAvg === null || bottomAvg === null ? null : topAvg - bottomAvg,
    predictions,
    weights,
    calculatedAt: new Date().toISOString(),
    dataVersion: scoreVersion(predictions),
    method:
      "営業日ごとに前日までの実績で採点し、同条件に該当する当日の実績と比較。上位・下位は各日の上位25%・下位25%。同機種標準化スコアと結果の差枚は別指標。後日訂正を含む現在DBによる回顧検証であり、当時の入手可能情報を完全再現する検証ではありません。",
  };
}
export function compareBacktest(
  db: DatabaseSync,
  input: Search,
  from: string,
  to: string,
  weights: Weights,
) {
  ensureScores(db);
  const current = backtest(db, input, from, to, weights),
    reference = backtest(db, input, from, to, defaultWeights);
  const result = { current, reference };
  db.prepare(
    "INSERT INTO backtest_runs(conditions_json,weights_json,result_json,calculated_at) VALUES(?,?,?,?)",
  ).run(
    JSON.stringify({ input, from, to }),
    JSON.stringify(weights),
    JSON.stringify(result),
    new Date().toISOString(),
  );
  return result;
}
