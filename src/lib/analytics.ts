import {
  getWeights,
  calculateExpectation,
  normalizedHall,
  sourceConsistency,
  scoreVersion,
  type Weights,
} from "./scoring";
import { summarize, averageDiff } from "./metrics";
import type { DatabaseSync } from "node:sqlite";
import { all } from "./db";
import {
  addDays,
  haversine,
  holidayName,
  holidayStreak,
  isDayOff,
  matchesDate,
} from "./calendar";
import type {
  Event,
  Hall,
  Machine,
  Ranking,
  Result,
  Search,
  SearchResponse,
  Source,
} from "./types";
const average = (a: number[]) =>
  a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
const clamp = (n: number, low = 0, high = 100) =>
  Math.max(low, Math.min(high, n));
export function evaluate(
  rows: Result[],
  baselineRows: Result[],
  referenceDate: string,
) {
  const stats = summarize(rows);
  const daily = rows.map((r) => averageDiff(r));
  const n = rows.length;
  const base =
    new Set(baselineRows.map((r) => r.date)).size >= 3
      ? summarize(baselineRows).avg
      : null;
  const spread = Math.max(
    200,
    Math.sqrt(
      average(baselineRows.map((r) => (averageDiff(r) - (base ?? 0)) ** 2)),
    ),
  );
  const completeness = n
    ? rows.reduce(
        (s, r) =>
          s +
          1 +
          (r.positive_units !== null ? 1 : 0) +
          (r.games !== null ? 1 : 0),
        0,
      ) /
      (n * 3)
    : 0;
  const shrinkage = n / (n + 8);
  const uplift = base === null ? null : stats.avg - base;
  const z = uplift === null ? null : Math.tanh(uplift / spread);
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const recent = sorted.slice(-3),
    prior = sorted.slice(-6, -3);
  const trend =
    recent.length === 3 && prior.length === 3
      ? summarize(recent).avg - summarize(prior).avg
      : null;
  const deviations = Math.sqrt(
    average(daily.map((v) => (v - average(daily)) ** 2)),
  );
  const recencyDays = sorted.length
    ? (+new Date(referenceDate) - +new Date(sorted.at(-1)!.date)) / 86400000
    : Infinity;
  const components: [number, number][] = [];
  if (z !== null) components.push([z, 0.5]);
  if (stats.positiveRate !== null)
    components.push([(stats.positiveRate - 50) / 50, 0.15]);
  if (stats.games !== null)
    components.push([clamp(stats.games / 6000, 0, 1) * 2 - 1, 0.1]);
  components.push([1 - clamp(deviations / spread, 0, 2), 0.1]);
  if (trend !== null) components.push([Math.tanh(trend / spread), 0.1]);
  components.push([Math.exp(-Math.max(0, recencyDays) / 90) * 2 - 1, 0.05]);
  const weighted =
    components.reduce((s, [v, w]) => s + v * w, 0) /
    components.reduce((s, [, w]) => s + w, 0);
  // Neutral prior at 50. Never score fewer than 3 dates or an absent machine baseline.
  const score =
    n < 3 || base === null
      ? null
      : Math.round(clamp(50 + 50 * shrinkage * weighted));
  const confidence = Math.round(
    100 *
      shrinkage *
      completeness *
      Math.min(1, stats.units / 100) *
      Math.exp(-Math.max(0, recencyDays) / 365),
  );
  return {
    ...stats,
    score,
    confidence,
    completeness: Math.round(completeness * 100),
    baseline: base,
    uplift,
    trend,
  };
}
export function search(
  db: DatabaseSync,
  input: Search,
  options: { weights?: Weights; audit?: boolean } = {},
): SearchResponse {
  const weights = options.weights ?? getWeights(db);
  const to = input.to || addDays(input.targetDate, -1),
    from = input.from || addDays(to, 1 - input.days);
  const halls = all<Hall>(
    db,
    "SELECT h.*,l.address,l.lat,l.lng FROM halls h JOIN hall_locations l ON l.hall_id=h.id",
  ).filter(
    (h) =>
      haversine(input.center, h) <= input.radius &&
      (input.rankingMode !== "hall" || h.id === input.hallId),
  );
  const machines = all<Machine>(db, "SELECT * FROM machines");
  const rawRows = all<Result>(
    db,
    "SELECT * FROM daily_machine_results WHERE date BETWEEN ? AND ? ORDER BY date",
    from,
    to,
  );
  const events = all<Event>(
    db,
    "SELECT * FROM events WHERE status != 'cancelled'",
  );
  const special = all<{ hall_id: string; kind: string; value: number }>(
    db,
    "SELECT * FROM special_days",
  );
  const sources = all<Source>(db, "SELECT * FROM data_sources");
  const consistency = sourceConsistency(db, rawRows, input.targetDate);
  const rows = rawRows.filter(
    (r) => !consistency.conflicts.has(consistency.key(r)),
  );
  const specialOn = (hallId: string, date: string) =>
    special.some(
      (s) =>
        s.hall_id === hallId &&
        s.value ===
          (s.kind === "digit"
            ? Number(date.slice(-2)) % 10
            : Number(date.slice(-2))),
    );
  const matches = (r: Result) =>
    matchesDate(r.date, input.conditions, {
      special: specialOn(r.hall_id, r.date),
      events: events.filter(
        (e) => e.hall_id === r.hall_id && e.date === r.date,
      ),
    });
  const previousFrom = `${Number(from.slice(0, 4)) - 1}${from.slice(4)}`,
    previousTo = `${Number(to.slice(0, 4)) - 1}${to.slice(4)}`;
  const previousRows = input.comparePrevious
    ? all<Result>(
        db,
        "SELECT * FROM daily_machine_results WHERE date BETWEEN ? AND ?",
        previousFrom,
        previousTo,
      )
    : [];
  const baselineFor = (machineId: string) =>
    rows.filter(
      (r) =>
        r.machine_id === machineId &&
        !isDayOff(r.date) &&
        !specialOn(r.hall_id, r.date) &&
        !events.some((e) => e.hall_id === r.hall_id && e.date === r.date),
    );
  const hallMetrics = new Map(
    halls.map((h) => [
      h.id,
      normalizedHall(
        rows.filter((r) => r.hall_id === h.id && matches(r)),
        baselineFor,
      ),
    ]),
  );
  const rankings: Ranking[] = [];
  let eligibleCount = 0;
  for (const hall of halls)
    for (const machine of machines) {
      if (
        input.rankingMode === "machine" &&
        !input.machineIds.includes(machine.id)
      )
        continue;
      const matching = rows.filter(
        (r) =>
          r.hall_id === hall.id && r.machine_id === machine.id && matches(r),
      );
      const installation =
        all<{ units: number }>(
          db,
          "SELECT units FROM hall_machine_installations WHERE hall_id=? AND machine_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?) ORDER BY valid_from DESC LIMIT 1",
          hall.id,
          machine.id,
          input.targetDate,
          input.targetEnd || input.targetDate,
        )[0]?.units ?? null;
      const historical = rows.some(
        (r) => r.hall_id === hall.id && r.machine_id === machine.id,
      );
      if (!historical && installation === null) continue;
      eligibleCount++;
      if (!matching.length) continue;
      const baseline = rows.filter(
        (r) =>
          r.machine_id === machine.id &&
          !isDayOff(r.date) &&
          !specialOn(r.hall_id, r.date) &&
          !events.some((e) => e.hall_id === r.hall_id && e.date === r.date),
      );
      const score = evaluate(matching, baseline, input.targetDate);
      const sameHall = rows.filter((r) => r.hall_id === hall.id);
      const hallMachineCount = new Set(sameHall.map((r) => r.machine_id)).size;
      const matchingMachineCount = new Set(
        sameHall.filter(matches).map((r) => r.machine_id),
      ).size;
      const eventTypes = input.conditions.eventType
        ? new Set(
            input.conditions.eventType === "any"
              ? events
                  .filter(
                    (e) => e.hall_id === hall.id && e.date < input.targetDate,
                  )
                  .map((e) => e.type)
              : [input.conditions.eventType],
          )
        : new Set(
            events
              .filter(
                (e) => e.hall_id === hall.id && e.date === input.targetDate,
              )
              .map((e) => e.type),
          );
      const eventRows = matching.filter((r) =>
        events.some(
          (e) =>
            e.hall_id === hall.id &&
            e.date === r.date &&
            eventTypes.has(e.type),
        ),
      );
      const conflictCount = rawRows.filter(
        (r) =>
          r.hall_id === hall.id &&
          r.machine_id === machine.id &&
          matches(r) &&
          consistency.conflicts.has(consistency.key(r)),
      ).length;
      const expectation = calculateExpectation({
        rows: matching,
        baseline,
        hall: hallMetrics.get(hall.id)!,
        eventRows,
        sources,
        date: input.targetDate,
        weights,
        consistency: conflictCount
          ? matching.length / (matching.length + conflictCount)
          : matching.some((r) => consistency.agreements.has(consistency.key(r)))
            ? 1
            : 0.85,
        conflicts: conflictCount,
        coverage: hallMachineCount
          ? matchingMachineCount / hallMachineCount
          : 0,
      });
      const lastYear = previousRows.filter(
        (r) =>
          r.hall_id === hall.id && r.machine_id === machine.id && matches(r),
      );
      const reasons = [
        `該当${matching.length}日中${matching.filter((r) => averageDiff(r) > 0).length}日で機種平均差枚がプラス`,
        score.uplift === null
          ? "同機種の通常日データ不足のため評価保留"
          : `同機種の通常日比 ${score.uplift >= 0 ? "+" : ""}${Math.round(score.uplift).toLocaleString()}枚／台`,
        `${matching.length}日分を中立スコア50へ縮小補正（n / (n + 8)）`,
      ];
      if (matching.length < 3) reasons.push("3日未満のため評価保留");
      if (score.completeness < 100)
        reasons.push("欠損指標は除外し、残る重みを再配分");
      rankings.push({
        hall,
        machine,
        distance: haversine(input.center, hall),
        installation,
        ...score,
        score: expectation.score,
        confidence: expectation.confidence,
        scoreDetail: expectation.detail,
        days: matching.length,
        reasons: [
          ...reasons,
          ...expectation.detail.components
            .filter((c) => c.signal !== null)
            .map((c) => `${c.label}：${c.reason}`),
          `未解決の競合${conflictCount}件を除外`,
        ],
        records: matching,
        sources: sources.filter((s) =>
          matching.some((r) => r.source_id === s.id),
        ),
        updatedAt: matching
          .map((r) => r.updated_at)
          .sort()
          .at(-1)!,
        previousAvg: lastYear.length ? summarize(lastYear).avg : null,
        events: events.filter(
          (e) =>
            e.hall_id === hall.id &&
            e.date >= input.targetDate &&
            e.date <= (input.targetEnd || input.targetDate),
        ),
      });
    }
  const version = scoreVersion({
    rows,
    events,
    special,
    weights,
    sources,
    conflicts: [...consistency.conflicts],
  });
  for (const hall of halls) {
    const candidates = rankings
      .filter((r) => r.hall.id === hall.id)
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    const best = candidates[0];
    if (!best) continue;
    const d = best.scoreDetail!,
      h = d.hallSampleScore;
    const coverage = d.hallCoverage;
    const bestAdjusted =
      best.score === null
        ? null
        : 50 +
          (best.score - 50) * Math.sqrt(coverage) * Math.min(1, d.days / 8);
    const hallScore =
      bestAdjusted === null || h === null
        ? null
        : Math.round(
            (bestAdjusted * weights.bestShare) / 100 +
              h * (1 - weights.bestShare / 100),
          );
    for (const r of candidates) {
      r.hallScore = hallScore;
      r.scoreDetail!.hallScore = hallScore;
      r.scoreDetail!.recommendedMachine = best.machine.name;
      r.scoreDetail!.recommendedScore = best.score;
      r.scoreDetail!.dataVersion = version;
    }
  }
  // Best-only always chooses the highest scoring machine, independently of display sort.
  let result = rankings;
  if (input.bestOnly) {
    const best = new Map<string, Ranking>();
    for (const r of [...rankings].sort(
      (a, b) => (b.score ?? -1) - (a.score ?? -1),
    ))
      if (!best.has(r.hall.id)) best.set(r.hall.id, r);
    result = [...best.values()];
  }
  const key = input.sort as
    "score" | "avg" | "positiveRate" | "confidence" | "days" | "distance";
  result.sort((a, b) =>
    key === "distance"
      ? a.distance - b.distance
      : (key === "score" && input.rankingMode === "auto"
          ? (b.hallScore ?? -Infinity) - (a.hallScore ?? -Infinity) ||
            (b.score ?? -Infinity) - (a.score ?? -Infinity)
          : (b[key] ?? -Infinity) - (a[key] ?? -Infinity)) ||
        a.hall.id.localeCompare(b.hall.id),
  );
  if (
    options.audit &&
    !db
      .prepare(
        "SELECT 1 FROM score_runs WHERE mode=? AND conditions_json=? AND weights_json=? AND data_version=? LIMIT 1",
      )
      .get(input.mode, JSON.stringify(input), JSON.stringify(weights), version)
  )
    db.prepare(
      "INSERT INTO score_runs(mode,conditions_json,weights_json,data_version,result_json,calculated_at) VALUES(?,?,?,?,?,?)",
    ).run(
      input.mode,
      JSON.stringify(input),
      JSON.stringify(weights),
      version,
      JSON.stringify(
        result.map((r) => ({
          hall: r.hall.id,
          machine: r.machine.id,
          score: r.score,
          hallScore: r.hallScore,
          detail: r.scoreDetail,
          records: r.records,
          sources: r.sources,
        })),
      ),
      new Date().toISOString(),
    );
  return {
    rankings: result,
    hallCount: halls.length,
    eligibleCount,
    from,
    to,
    targetHoliday: holidayName(input.targetDate),
    streak: holidayStreak(input.targetDate),
    warning: consistency.conflicts.size
      ? `未解決の競合${consistency.conflicts.size}件を評価対象から除外しています。`
      : to < "2026-01-01"
        ? "古い対象期間です。更新日時を確認してください。"
        : null,
  };
}
