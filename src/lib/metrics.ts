import type { Result } from "./types";
export function summarize(rows: Result[]) {
  const units = rows.reduce((s, r) => s + r.units, 0),
    total = rows.reduce((s, r) => s + r.total_diff, 0);
  const positive = rows.filter((r) => r.positive_units !== null),
    games = rows.filter((r) => r.games !== null);
  return {
    total,
    avg: units ? total / units : 0,
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
