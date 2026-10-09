import holiday from "@holiday-jp/holiday_jp";

export function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s;
}
export function addDays(s: string, days: number): string {
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function todayJST(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}
export function weekday(s: string): number {
  return new Date(`${s}T12:00:00Z`).getUTCDay();
}
// Lookup date keys directly: independent of server timezone and avoids scanning all years.
export function holidayName(s: string): string | null {
  return (
    (holiday.holidays as Record<string, { name: string }>)[s]?.name ?? null
  );
}
export function isDayOff(s: string): boolean {
  return [0, 6].includes(weekday(s)) || !!holidayName(s);
}
export function holidayStreak(s: string) {
  if (!isDayOff(s))
    return { length: 0, index: 0, position: "none", start: s, end: s };
  let start = s,
    end = s;
  while (isDayOff(addDays(start, -1))) start = addDays(start, -1);
  while (isDayOff(addDays(end, 1))) end = addDays(end, 1);
  const length =
    Math.round((+new Date(end) - +new Date(start)) / 86400_000) + 1;
  const index = Math.round((+new Date(s) - +new Date(start)) / 86400_000) + 1;
  return {
    length,
    index,
    position: index === 1 ? "first" : index === length ? "last" : "middle",
    start,
    end,
  };
}
export function isDouble(s: string): boolean {
  const [, m, d] = s.split("-").map(Number);
  return d === 11 || d === 22 || m === d;
}
export type DateConditions = {
  digits: number[];
  monthDays: number[];
  weekdays: number[];
  dayGroup: string;
  doubles: boolean;
  minStreak: number;
  streakPosition: string;
  streakIndex: number;
  special: boolean;
  eventType: string;
  eventText: string;
  join: "AND" | "OR";
};
export const emptyConditions: DateConditions = {
  digits: [],
  monthDays: [],
  weekdays: [],
  dayGroup: "",
  doubles: false,
  minStreak: 0,
  streakPosition: "",
  streakIndex: 0,
  special: false,
  eventType: "",
  eventText: "",
  join: "AND",
};
export function matchesDate(
  s: string,
  c: DateConditions,
  context: {
    special: boolean;
    events: { type: string; name: string; performer: string }[];
  } = { special: false, events: [] },
): boolean {
  const checks: boolean[] = [];
  const day = Number(s.slice(-2));
  if (c.digits.length) checks.push(c.digits.includes(day % 10));
  if (c.monthDays.length) checks.push(c.monthDays.includes(day));
  if (c.weekdays.length) checks.push(c.weekdays.includes(weekday(s)));
  if (c.dayGroup)
    checks.push(
      c.dayGroup === "weekdays"
        ? !isDayOff(s)
        : c.dayGroup === "weekend"
          ? [0, 6].includes(weekday(s))
          : isDayOff(s),
    );
  if (c.doubles) checks.push(isDouble(s));
  if (c.minStreak || c.streakPosition || c.streakIndex) {
    const h = holidayStreak(s);
    checks.push(
      h.length >= Math.max(3, c.minStreak) &&
        (!c.streakPosition || h.position === c.streakPosition) &&
        (!c.streakIndex || h.index === c.streakIndex),
    );
  }
  if (c.special) checks.push(context.special);
  if (c.eventType || c.eventText)
    checks.push(
      context.events.some(
        (e) =>
          (!c.eventType || c.eventType === "any" || e.type === c.eventType) &&
          (!c.eventText || `${e.name} ${e.performer}`.includes(c.eventText)),
      ),
    );
  return (
    !checks.length ||
    (c.join === "AND" ? checks.every(Boolean) : checks.some(Boolean))
  );
}
export function haversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const r = Math.PI / 180;
  const dlat = (b.lat - a.lat) * r,
    dlng = (b.lng - a.lng) * r;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlng / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function normalizeMachine(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s・･ー－_\-]/g, "");
}
