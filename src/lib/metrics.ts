import type { Result } from "./types";
export const averageDiff = (r: Result) =>
  r.avg_diff ?? (r.total_diff === null ? 0 : r.total_diff / r.units);
export function summarize(rows: Result[]) {
  const units = rows.reduce((s, r) => s + r.units, 0),
    total = rows.every((r) => r.total_diff !== null)
      ? rows.reduce((s, r) => s + r.total_diff!, 0)
      : null;
  const positive = rows.filter((r) => r.positive_units !== null),
    games = rows.filter((r) => r.games !== null);
  return {
    total,
    avg: units
      ? rows.reduce((s, r) => s + averageDiff(r) * r.units, 0) / units
      : 0,
    positiveRate: positive.length
      ? (positive.reduce((s, r) => s + r.positive_units!, 0) /
          positive.reduce((s, r) => s + r.units, 0)) *
        100
      : null,
    games: games.length
      ? games.reduce((s, r) => s + r.games! * r.units, 0) /
        games.reduce((s, r) => s + r.units, 0)
      : null,
    units,
  };
}
