// These categories come from the user's research brief, not verified site contents.
export const sourceCandidates = [
  {
    id: "min-repo",
    name: "みんレポ",
    url: "https://min-repo.com/",
    category: "出玉・台番別実績",
  },
  {
    id: "ana-slo",
    name: "アナスロ",
    url: "https://ana-slo.com/",
    category: "出玉・台番別実績",
  },
  {
    id: "slo-map",
    name: "スロマップ slot-ai",
    url: "https://lab.slo-map.com/slot-ai",
    category: "出玉・台番別実績",
  },
  {
    id: "hall-navi",
    name: "ホールナビ",
    url: "https://hall-navi.com/",
    category: "イベント・取材・特定日",
  },
  {
    id: "slopachi",
    name: "スロパチステーション",
    url: "https://777.slopachi-station.com/report/",
    category: "イベント・取材・特定日",
  },
  {
    id: "dmm-p-town",
    name: "DMMぱちタウン",
    url: "https://p-town.dmm.com/",
    category: "イベント・取材・特定日",
  },
  {
    id: "janbari",
    name: "JANBARI",
    url: "https://janbari.com/",
    category: "イベント・取材・特定日",
  },
  {
    id: "p-world",
    name: "P-WORLD",
    url: "https://www.p-world.co.jp/",
    category: "ホール・設置機種情報",
  },
] as const;

export const STANDARD_DEFINITION =
  "差枚=払出−投入、games=1台平均ゲーム数、positive_units=差枚>0の台数";
export const DEFINITION_CODE = "machine-daily-v1";
export const providerIds = ["user", ...sourceCandidates.map((s) => s.id)];
