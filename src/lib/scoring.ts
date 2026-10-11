import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { z } from "zod";
import { averageDiff, summarize } from "./metrics";
import type { Result, Source } from "./types";
export const defaultWeights = {
  machine: 35,
  stability: 25,
  recent: 15,
  hall: 15,
  event: 10,
  bestShare: 65,
};
export const weightsSchema = z
  .object({
    machine: z.number().min(0).max(100),
    stability: z.number().min(0).max(100),
    recent: z.number().min(0).max(100),
    hall: z.number().min(0).max(100),
    event: z.number().min(0).max(100),
    bestShare: z.number().min(0).max(100),
  })
  .strict()
  .refine(
    (w) =>
      Math.abs(w.machine + w.stability + w.recent + w.hall + w.event - 100) <
      0.0001,
    "5項目の配点合計を100にしてください",
  );
export type Weights = z.infer<typeof weightsSchema>;
export const componentNames = {
  machine: "機種別出玉実績",
  stability: "好成績の安定性",
  recent: "直近の実績傾向",
  hall: "ホールの同条件実績",
  event: "イベントとの過去相関",
};
export function ensureScores(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS score_settings(id INTEGER PRIMARY KEY CHECK(id=1),weights_json TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS score_runs(id INTEGER PRIMARY KEY,mode TEXT NOT NULL,conditions_json TEXT NOT NULL,weights_json TEXT NOT NULL,data_version TEXT NOT NULL,result_json TEXT NOT NULL,calculated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS backtest_runs(id INTEGER PRIMARY KEY,conditions_json TEXT NOT NULL,weights_json TEXT NOT NULL,result_json TEXT NOT NULL,calculated_at TEXT NOT NULL);`);
}
export function getWeights(db: DatabaseSync): Weights {
  ensureScores(db);
  const r = db
    .prepare("SELECT weights_json FROM score_settings WHERE id=1")
    .get() as { weights_json: string } | undefined;
  return r ? JSON.parse(r.weights_json) : { ...defaultWeights };
}
export function setWeights(db: DatabaseSync, v: unknown) {
  const weights = weightsSchema.parse(v);
  ensureScores(db);
  db.prepare(
    "INSERT INTO score_settings VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET weights_json=excluded.weights_json,updated_at=excluded.updated_at",
  ).run(JSON.stringify(weights), new Date().toISOString());
  return weights;
}
const mean = (a: number[]) =>
  a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const uniqueDays = (rows: Result[]) => new Set(rows.map((r) => r.date)).size;
const clamp = (n: number, a = 0, b = 100) => Math.min(b, Math.max(a, n));
export function baselineStats(rows: Result[]) {
  if (uniqueDays(rows) < 3) return null;
  const avg = summarize(rows).avg,
    spread = Math.max(
      200,
      Math.sqrt(mean(rows.map((r) => (averageDiff(r) - avg) ** 2))),
    );
  return { avg, spread };
}
export function normalizedHall(
  rows: Result[],
  baseline: (id: string) => Result[],
) {
  const cached = new Map(
    [...new Set(rows.map((r) => r.machine_id))].map((id) => [
      id,
      baselineStats(baseline(id)),
    ]),
  );
  const values = rows.flatMap((r) => {
    const b = cached.get(r.machine_id);
    return b
      ? [
          {
            value: Math.tanh((averageDiff(r) - b.avg) / b.spread),
            units: r.units,
            date: r.date,
          },
        ]
      : [];
  });
  const dates = new Set(values.map((v) => v.date)).size;
  return {
    signal:
      dates >= 3
        ? values.reduce((s, v) => s + v.value * v.units, 0) /
          values.reduce((s, v) => s + v.units, 0)
        : null,
    days: dates,
    units: values.reduce((s, v) => s + v.units, 0),
    machines: new Set(rows.map((r) => r.machine_id)).size,
  };
}
export type ScoreDetail = {
  components: {
    key: string;
    label: string;
    weight: number;
    signal: number | null;
    points: number | null;
    contribution: number;
    reason: string;
  }[];
  confidenceReasons: string[];
  days: number;
  units: number;
  cumulativeGames: number | null;
  missingRate: number;
  sourceQuality: number;
  consistency: number;
  shrinkage: number;
  status: string;
  baseline: number | null;
  spread: number | null;
  eventDays: number;
  lastDate: string | null;
  lastAvg: number | null;
  dataVersion: string;
  calculatedAt: string;
  conflicts: number;
  hallCoverage: number;
  hallSampleScore: number | null;
  hallScore: number | null;
  recommendedMachine: string;
  recommendedScore: number | null;
  weights: Weights;
};
export function calculateExpectation(args: {
  rows: Result[];
  baseline: Result[];
  hall: ReturnType<typeof normalizedHall>;
  eventRows: Result[];
  sources: Source[];
  date: string;
  weights: Weights;
  consistency: number;
  conflicts: number;
  coverage: number;
}) {
  const { rows, baseline, hall, eventRows, sources, date, weights } = args,
    n = uniqueDays(rows),
    base = baselineStats(baseline),
    stats = summarize(rows),
    shrinkage = n / (n + 8),
    sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const recent = sorted.slice(-3),
    prior = sorted.slice(-6, -3),
    trend =
      recent.length === 3 && prior.length === 3
        ? summarize(recent).avg - summarize(prior).avg
        : null;
  const eventDays = uniqueDays(eventRows),
    event =
      base && eventDays >= 3
        ? (Math.tanh((summarize(eventRows).avg - base.avg) / base.spread) *
            eventDays) /
          (eventDays + 8)
        : null;
  const signals = {
    machine: base ? Math.tanh((stats.avg - base.avg) / base.spread) : null,
    stability:
      base && n >= 3
        ? ((2 * rows.filter((r) => averageDiff(r) > base.avg).length) /
            rows.length -
            1) /
          (1 +
            Math.sqrt(
              mean(rows.map((r) => (averageDiff(r) - stats.avg) ** 2)),
            ) /
              base.spread)
        : null,
    recent: base && trend !== null ? Math.tanh(trend / base.spread) : null,
    hall: hall.signal,
    event,
  };
  const reasons = {
    machine: base
      ? `同機種通常日比 ${Math.round(stats.avg - base.avg)}枚／台、基準分散幅 ${Math.round(base.spread)}枚`
      : "通常日が3営業日未満",
    stability: base
      ? `通常日平均を上回った日 ${rows.filter((r) => averageDiff(r) > base.avg).length}/${n}日。変動の大きさで補正`
      : "通常日の比較基準なし",
    recent:
      trend === null
        ? "前後3営業日ずつの比較には6日以上必要"
        : `直近3日−前3日 ${Math.round(trend)}枚／台`,
    hall: `機種ごとに標準化した収録実績 ${hall.days}営業日（店舗全台の網羅は未保証）`,
    event:
      event === null
        ? "同条件・同イベント種別の過去実績が3日未満、または比較基準なし"
        : `同条件・同イベント種別 ${eventDays}日を通常日と比較（因果関係ではない）`,
  };
  const entries = Object.keys(signals) as (keyof typeof signals)[],
    active = entries.reduce(
      (s, k) => s + (signals[k] === null ? 0 : weights[k]),
      0,
    );
  const score =
    n < 3 || !base || !active
      ? null
      : Math.round(
          clamp(
            50 +
              (50 *
                shrinkage *
                entries.reduce(
                  (s, k) => s + (signals[k] ?? 0) * weights[k],
                  0,
                )) /
                active,
          ),
        );
  const completeness = rows.length
    ? rows.reduce(
        (s, r) =>
          s +
          1 +
          (r.positive_units !== null ? 1 : 0) +
          (r.games !== null ? 1 : 0),
        0,
      ) /
      (rows.length * 3)
    : 0;
  const gamesRows = rows.filter((r) => r.games !== null),
    cumulativeGames = gamesRows.length
      ? gamesRows.reduce((s, r) => s + r.games! * r.units, 0)
      : null;
  const sourceQuality = rows.length
    ? mean(
        rows.map((r) => {
          const s = sources.find((s) => s.id === r.source_id);
          if (!s || !s.url || !s.permission) return 0.2;
          if (
            s.reliability.includes("未監査") ||
            s.reliability.includes("デモ")
          )
            return 0.6;
          return 0.7;
        }),
      )
    : 0;
  const age = sorted.length
    ? Math.max(
        0,
        (Date.parse(date) - Date.parse(sorted.at(-1)!.date)) / 86400000,
      )
    : Infinity;
  const confidence = Math.round(
    Math.min(
      n <= 5 ? 35 : 100,
      100 *
        shrinkage *
        completeness *
        Math.min(1, stats.units / 100) *
        Math.min(1, (cumulativeGames ?? 0) / 100000) *
        sourceQuality *
        args.consistency *
        Math.exp(-age / 365),
    ),
  );
  const detail: ScoreDetail = {
    components: entries.map((k) => ({
      key: k,
      label: componentNames[k],
      weight: weights[k],
      signal: signals[k],
      points: signals[k] === null ? null : 50 + 50 * signals[k]!,
      contribution:
        score === null || !active
          ? 0
          : (50 * shrinkage * (signals[k] ?? 0) * weights[k]) / active,
      reason: reasons[k],
    })),
    confidenceReasons: [
      `${n}営業日・対象延べ${stats.units}台（3〜5日は上限35）`,
      `累積ゲーム数 ${cumulativeGames === null ? "未取得" : Math.round(cumulativeGames).toLocaleString()}G（平均G×台数の集計値）`,
      `欠損率 ${Math.round((1 - completeness) * 100)}%・出典係数 ${sourceQuality.toFixed(2)}・整合係数 ${args.consistency.toFixed(2)}`,
      `データ経過 ${Number.isFinite(age) ? age : "未取得"}日、少数標本補正 n/(n+8)=${shrinkage.toFixed(3)}`,
    ],
    days: n,
    units: stats.units,
    cumulativeGames,
    missingRate: 1 - completeness,
    sourceQuality,
    consistency: args.consistency,
    shrinkage,
    status:
      n === 0
        ? "評価不可"
        : score === null
          ? "評価保留"
          : n <= 5
            ? "低信頼"
            : "相対評価",
    baseline: base?.avg ?? null,
    spread: base?.spread ?? null,
    eventDays,
    lastDate: sorted.at(-1)?.date ?? null,
    lastAvg: sorted.length ? averageDiff(sorted.at(-1)!) : null,
    dataVersion: "",
    calculatedAt: new Date().toISOString(),
    conflicts: args.conflicts,
    hallCoverage: args.coverage,
    hallSampleScore:
      hall.signal === null
        ? null
        : Math.round(
            clamp(50 + ((50 * hall.days) / (hall.days + 8)) * hall.signal),
          ),
    hallScore: null,
    recommendedMachine: "",
    recommendedScore: null,
    weights,
  };
  return { score, confidence, detail };
}
export function scoreVersion(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
// Compare reported metrics, not source URLs or name spelling. A different definition is also a conflict.
function comparable(p: Record<string, unknown>) {
  return JSON.stringify([
    p.total_diff ?? null,
    p.avg_diff ?? null,
    p.units ?? null,
    p.games ?? null,
    p.positive_units ?? null,
    p.definition ?? null,
  ]);
}
export function sourceConsistency(
  db: DatabaseSync,
  rows: Result[],
  cutoff?: string,
) {
  const map = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  const key = (h: string, m: string, d: string) => `${h}/${m}/${d}`;
  const collect = (
    h: string,
    m: string,
    d: string,
    p: Record<string, unknown>,
  ) => {
    const k = key(h, m, d);
    if (!map.has(k)) map.set(k, new Set());
    map.get(k)!.add(comparable(p));
    counts.set(k, (counts.get(k) || 0) + 1);
  };
  for (const row of db
    .prepare(
      "SELECT payload_json,created_at FROM collected_records WHERE kind='results'",
    )
    .all()) {
    const p = JSON.parse(row.payload_json as string);
    if (cutoff && String(p.date) >= cutoff) continue;
    collect(p.hall_id, p.machine_id, p.date, p);
  }
  for (const row of db
    .prepare(
      "SELECT payload_json,hall_id,machine_id,date FROM source_observations",
    )
    .all()) {
    if (cutoff && String(row.date) >= cutoff) continue;
    const p = JSON.parse(row.payload_json as string);
    collect(String(row.hall_id), String(row.machine_id), String(row.date), p);
  }
  const conflicts = new Set<string>(),
    agreements = new Set<string>();
  for (const r of rows) {
    const k = key(r.hall_id, r.machine_id, r.date),
      values = map.get(k);
    if (values && values.size > 1) conflicts.add(k);
    else if (values && (counts.get(k) || 0) > 1) agreements.add(k);
  }
  return {
    conflicts,
    agreements,
    key: (r: Result) => key(r.hall_id, r.machine_id, r.date),
  };
}
