import assert from "node:assert/strict";
import { emptyConditions, holidayStreak } from "../src/lib/calendar";
import type { Search, SearchResponse } from "../src/lib/types";
async function main() {
  const origin = process.env.SMOKE_ORIGIN || "http://127.0.0.1:3000";
  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  const input: Search = {
    mode: "demo",
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
  const query = async (patch: Partial<Search>) => {
    const res = await fetch(`${origin}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, ...patch }),
    });
    assert.equal(res.status, 200);
    return (await res.json()) as SearchResponse;
  };
  const a = await query({ rankingMode: "machine", machineIds: ["kabaneri"] });
  assert.ok(a.rankings.length > 1);
  assert.ok(
    a.rankings.every((r) => r.machine.id === "kabaneri" && r.distance <= 30),
  );
  const b = await query({});
  assert.ok(new Set(b.rankings.map((r) => r.machine.id)).size >= 4);
  const c = await query({
    rankingMode: "hall",
    hallId: "demo-nagaoka",
    conditions: { ...emptyConditions, monthDays: [11] },
  });
  assert.ok(c.rankings.length > 0);
  assert.ok(
    c.rankings.every(
      (r) =>
        r.hall.id === "demo-nagaoka" &&
        r.records.every((d) => d.date.endsWith("-11")),
    ),
  );
  const d = await query({
    rankingMode: "machine",
    machineIds: ["juggler"],
    conditions: { ...emptyConditions, minStreak: 3, streakPosition: "last" },
  });
  assert.ok(d.rankings.length >= 2);
  assert.ok(
    d.rankings.every((r) =>
      r.records.every((x) => {
        const h = holidayStreak(x.date);
        return h.length >= 3 && h.position === "last";
      }),
    ),
  );
  const real = await query({ mode: "real" });
  assert.equal(real.rankings.length, 0);
  console.log(
    `HTTP smoke passed: A=${a.rankings.length}, B=${b.rankings.length}, C=${c.rankings.length}, D/E=${d.rankings.length}, real=0. All record dates satisfy the selected conditions.`,
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
