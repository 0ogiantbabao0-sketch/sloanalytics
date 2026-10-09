import { summarize } from "./metrics";
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
  const daily = rows.map((r) => r.total_diff / r.units);
  const n = rows.length;
  const base =
    new Set(baselineRows.map((r) => r.date)).size >= 3
      ? summarize(baselineRows).avg
      : null;
  const spread = Math.max(
    200,
    Math.sqrt(
      average(
        baselineRows.map((r) => (r.total_diff / r.units - (base ?? 0)) ** 2),
      ),
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
export function search(db: DatabaseSync, input: Search): SearchResponse {
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
  const rows = all<Result>(
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
      const lastYear = previousRows.filter(
        (r) =>
          r.hall_id === hall.id && r.machine_id === machine.id && matches(r),
      );
      const reasons = [
        `該当${matching.length}日中${matching.filter((r) => r.total_diff > 0).length}日で機種平均差枚がプラス`,
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
        days: matching.length,
        reasons,
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
      : (b[key] ?? -Infinity) - (a[key] ?? -Infinity) ||
        a.hall.id.localeCompare(b.hall.id),
  );
  return {
    rankings: result,
    hallCount: halls.length,
    eligibleCount,
    from,
    to,
    targetHoliday: holidayName(input.targetDate),
    streak: holidayStreak(input.targetDate),
    warning:
      to < "2026-01-01"
        ? "古い対象期間です。更新日時を確認してください。"
        : null,
  };
}
