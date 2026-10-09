import { initialMachines } from "../src/lib/machine-catalog";
import { getDb } from "../src/lib/db";
import { addDays, isDayOff } from "../src/lib/calendar";
const real = getDb("real");
const db = getDb("demo");
if (!(db.prepare("SELECT count(*) AS n FROM halls").get() as { n: number }).n) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO data_sources VALUES(?,?,?,?,?,?,?,?,?)").run(
      "demo",
      "SLOT ANALYTICS 合成サンプル",
      "https://example.com/slot-analytics-demo",
      "generated",
      "開発検証用の合成データ。実店舗の実績ではありません",
      "デモ",
      "差枚=払出−投入、ゲーム数=1台平均",
      now,
      null,
    );
    const halls = [
      [
        "demo-kyoto",
        "デモ京都ステーション",
        "京都府京都市・架空店舗",
        34.986,
        135.758,
      ],
      [
        "demo-nagaoka",
        "デモ長岡京パーク",
        "京都府長岡京市・架空店舗",
        34.923,
        135.7,
      ],
      [
        "demo-takatsuki",
        "デモ高槻セントラル",
        "大阪府高槻市・架空店舗",
        34.851,
        135.617,
      ],
      [
        "demo-osaka",
        "デモ梅田グランド",
        "大阪府大阪市・架空店舗",
        34.704,
        135.498,
      ],
      [
        "demo-shiga",
        "デモ大津レイク",
        "滋賀県大津市・架空店舗",
        35.006,
        135.865,
      ],
      [
        "demo-kobe",
        "デモ神戸ハーバー",
        "兵庫県神戸市・架空店舗",
        34.69,
        135.194,
      ],
    ] as const;
    const machines = initialMachines;
    let random = 20261010;
    const rng = () => {
      random = (random * 1664525 + 1013904223) >>> 0;
      return random / 4294967296;
    };
    for (const [h, [id, name, address, lat, lng]] of halls.entries()) {
      db.prepare(
        "INSERT INTO halls(id,name,hours,lottery_time,lottery_place,lottery_method,parking) VALUES(?,?,?,?,?,?,?)",
      ).run(
        id,
        name,
        "10:00〜22:45（デモ）",
        "09:30（デモ）",
        "正面入口（デモ）",
        "抽選（デモ）",
        "未取得",
      );
      db.prepare("INSERT INTO hall_locations VALUES(?,?,?,?)").run(
        id,
        address,
        lat,
        lng,
      );
      db.prepare("INSERT INTO special_days VALUES(?,?,?,?)").run(
        id,
        "digit",
        h % 3 === 0 ? 0 : h % 3 === 1 ? 1 : 7,
        "demo",
      );
      for (const [m, [machineId]] of machines.entries()) {
        const units = [12, 24, 16, 8][m] + h * 2;
        db.prepare(
          "INSERT INTO hall_machine_installations VALUES(?,?,?,?,?)",
        ).run(id, machineId, "2025-01-01", null, units);
        for (
          let date = "2025-01-01";
          date <= "2026-10-09";
          date = addDays(date, 1)
        ) {
          if (rng() < 0.055) continue;
          const day = Number(date.slice(-2));
          const advantage =
            (day % 10 === (h % 3 === 0 ? 0 : h % 3 === 1 ? 1 : 7) ? 250 : 0) +
            (isDayOff(date) ? (h % 2 === 0 ? 210 : 40) : 0);
          const avg = Math.round(
            -130 + advantage + (rng() - 0.5) * 1000 + (h === m ? 160 : 0),
          );
          const plus = Math.max(
            0,
            Math.min(
              units,
              Math.round(units * (0.46 + avg / 2200 + (rng() - 0.5) * 0.2)),
            ),
          );
          db.prepare(
            "INSERT INTO daily_machine_results VALUES(?,?,?,?,?,?,?,?,?)",
          ).run(
            id,
            machineId,
            date,
            avg * units,
            units,
            rng() < 0.025 ? null : plus,
            rng() < 0.025 ? null : Math.round(3200 + rng() * 3800),
            "demo",
            now,
          );
          if (date >= "2026-10-01")
            for (let u = 0; u < Math.min(units, 12); u++)
              db.prepare(
                "INSERT INTO daily_unit_results VALUES(?,?,?,?,?,?,?,?,?,?)",
              ).run(
                id,
                machineId,
                date,
                String(100 + m * 30 + u),
                Math.round(avg + (rng() - 0.5) * 3000),
                Math.round(4000 + rng() * 3000),
                Math.round(10 + rng() * 20),
                Math.round(8 + rng() * 18),
                u === 0 ? "corner" : "middle",
                "demo",
              );
        }
      }
      for (const date of [
        "2026-09-11",
        "2026-09-22",
        "2026-10-10",
        "2026-10-11",
        "2026-10-12",
      ]) {
        const eventId = `${id}-${date}`;
        db.prepare("INSERT INTO events VALUES(?,?,?,?,?,?,?,?)").run(
          eventId,
          id,
          date,
          "デモ取材企画",
          "coverage",
          "",
          date < "2026-10-10" ? "confirmed" : "announced",
          now,
        );
        db.prepare("INSERT INTO event_sources VALUES(?,?,?)").run(
          eventId,
          "demo",
          "https://example.com/slot-analytics-demo",
        );
      }
      for (const [kind, people] of [
        ["actual", 135],
        ["forecast", 160],
        ["limit", 300],
        ["reported_average", 120],
      ] as const)
        db.prepare(
          "INSERT INTO lottery_records(hall_id,date,kind,people,source_id) VALUES(?,?,?,?,?)",
        ).run(id, "2026-10-09", kind, people + h * 20, "demo");
    }
    db.exec("COMMIT");
    console.log(
      "Seeded deterministic synthetic dataset: 6 halls, 4 machines, 2025-01-01–2026-10-09.",
    );
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
} else console.log("Demo data already exists; preserved.");
console.log("Real database initialized; no synthetic records added.");
real.close();
db.close();
