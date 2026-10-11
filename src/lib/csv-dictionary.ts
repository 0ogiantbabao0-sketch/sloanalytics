export const kinds = ["halls", "installations", "results"] as const;
export type ImportKind = (typeof kinds)[number];
export const kindLabels = {
  halls: "ホール基本情報",
  installations: "設置機種",
  results: "機種別日次実績",
};
export const fields: Record<string, string> = {
  data_kind: "データ種別（demo / real）",
  hall_id: "店舗ID",
  hall_name: "店舗名",
  hall_external_id: "取得元の店舗ID",
  address: "住所",
  lat: "緯度",
  lng: "経度",
  official_url: "公式URL",
  hours: "営業時間",
  lottery_time: "抽選時刻",
  machine_id: "機種ID",
  machine_name: "機種名",
  machine_external_id: "取得元の機種ID",
  manufacturer: "メーカー",
  model: "型式",
  date: "営業日",
  survey_date: "調査日",
  valid_from: "有効開始日",
  valid_to: "有効終了日",
  units: "対象／設置台数",
  avg_diff: "平均差枚",
  total_diff: "総差枚",
  positive_units: "プラス台数",
  positive_rate: "プラス台率（%）",
  games: "平均G数",
  payout_rate: "出玉率（%・参考値）",
  win_rate: "勝率（参考値・原表記）",
  points: "差枚相当ポイント（参考値）",
  source_url: "出典URL",
  published_at: "公開日時",
  source_updated_at: "提供元更新日時",
};
const aliases: Record<string, string[]> = {
  hall_id: ["店舗ID", "ホールID"],
  hall_name: ["店名", "ホール名", "店舗名", "店舗"],
  address: ["住所", "所在地"],
  lat: ["緯度"],
  lng: ["経度"],
  machine_name: ["機種", "機種名", "台名称"],
  machine_id: ["機種ID"],
  units: ["台数", "対象台数", "設置台数"],
  date: ["日付", "営業日"],
  survey_date: ["調査日"],
  valid_from: ["有効開始日"],
  valid_to: ["有効終了日"],
  avg_diff: ["平均差枚", "平均差枚数"],
  total_diff: ["総差枚", "合計差枚", "総差枚数"],
  games: ["平均G数", "平均ゲーム数", "平均回転数"],
  positive_units: ["プラス台数"],
  positive_rate: ["プラス台率"],
  payout_rate: ["出玉率", "出率"],
  win_rate: ["勝率"],
  points: ["差枚相当ポイント"],
  official_url: ["公式URL"],
  hours: ["営業時間"],
  lottery_time: ["抽選時刻"],
  source_url: ["出典URL"],
  data_kind: ["データ種別"],
  manufacturer: ["メーカー"],
  model: ["型式"],
};
const key = (s: string) =>
  s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
export function suggestMapping(headers: string[]) {
  return Object.fromEntries(
    headers.map((h) => [
      h,
      Object.keys(fields).find(
        (f) => key(f) === key(h) || aliases[f]?.some((a) => key(a) === key(h)),
      ) || "",
    ]),
  );
}
export const requiredGroups: Record<ImportKind, string[][]> = {
  halls: [
    ["data_kind"],
    ["hall_id"],
    ["hall_name"],
    ["address"],
    ["lat"],
    ["lng"],
  ],
  installations: [
    ["data_kind"],
    ["hall_id", "hall_name", "hall_external_id"],
    ["machine_id", "machine_name", "machine_external_id"],
    ["units"],
    ["valid_from", "survey_date"],
  ],
  results: [
    ["data_kind"],
    ["hall_id", "hall_name", "hall_external_id"],
    ["machine_id", "machine_name", "machine_external_id"],
    ["date"],
    ["units"],
    ["avg_diff", "total_diff"],
  ],
};
