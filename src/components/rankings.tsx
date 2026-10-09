"use client";
import Link from "next/link";
import { ArrowUpRight, Bookmark, MapPin, Info, TrendingUp } from "lucide-react";
import type { Ranking } from "@/lib/types";
import { useApp } from "./provider";
export const num = (n: number | null | undefined, d = 0) =>
  n == null
    ? "未取得"
    : n.toLocaleString("ja-JP", { maximumFractionDigits: d });
export const signed = (n: number | null) =>
  n === null ? "未取得" : `${n >= 0 ? "+" : ""}${num(n)}`;
export function RankingCard({
  item: r,
  index,
  selected = false,
  onSelect,
}: {
  item: Ranking;
  index: number;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const { store, toggleFavorite, toggleCompare } = useApp();
  return (
    <article
      id={`hall-${r.hall.id}-${r.machine.id}`}
      className={`ranking-card panel ${selected ? "highlight" : ""}`}
      onMouseEnter={onSelect}
    >
      <div className="ranking-top">
        <span className={`rank-number ${index < 3 ? "top" : ""}`}>
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="ranking-name">
          <Link href={`/halls/${r.hall.id}`}>
            {r.hall.name}
            <ArrowUpRight size={15} />
          </Link>
          <Link className="machine-link" href={`/machines/${r.machine.id}`}>
            {r.machine.name}
          </Link>
          <div className="card-tags">
            <span>
              <MapPin size={12} />
              {r.distance.toFixed(1)}km
            </span>
            <span>
              対象日の設置{" "}
              {r.installation === null ? "未取得" : `${r.installation}台`}
            </span>
            <span>{r.days}日分</span>
          </div>
        </div>
        <div className="score-block">
          <small>総合スコア</small>
          <div>
            {r.score === null ? (
              <span className="pending">評価保留</span>
            ) : (
              <>
                <b>{r.score}</b>
                <span>/ 100</span>
              </>
            )}
          </div>
          <span className={`confidence ${r.confidence >= 60 ? "high" : ""}`}>
            信頼度 {r.confidence}%
          </span>
        </div>
        <button
          type="button"
          className={`icon-button favorite ${store.favorites.includes(`hall:${r.hall.id}`) ? "on" : ""}`}
          aria-label={`${r.hall.name}をお気に入り`}
          onClick={() => toggleFavorite(`hall:${r.hall.id}`)}
        >
          <Bookmark
            size={19}
            fill={
              store.favorites.includes(`hall:${r.hall.id}`)
                ? "currentColor"
                : "none"
            }
          />
        </button>
      </div>
      <div className="metrics">
        <div>
          <small>平均差枚 / 台</small>
          <strong className={r.avg >= 0 ? "positive" : ""}>
            {signed(r.avg)}
            <em>枚</em>
          </strong>
        </div>
        <div>
          <small>プラス台率</small>
          <strong>
            {num(r.positiveRate, 1)}
            {r.positiveRate !== null && <em>%</em>}
          </strong>
        </div>
        <div>
          <small>平均稼働</small>
          <strong>
            {num(r.games)}
            {r.games !== null && <em>G</em>}
          </strong>
        </div>
        <div>
          <small>通常日との差</small>
          <strong className={(r.uplift ?? 0) >= 0 ? "positive" : ""}>
            {signed(r.uplift)}
            {r.uplift !== null && <em>枚</em>}
          </strong>
        </div>
      </div>
      <div className="reason-box">
        <TrendingUp size={15} />
        <span>
          {r.reasons[0]}
          <br />
          <small>{r.reasons[1]}</small>
        </span>
      </div>
      <div className="card-bottom">
        <label>
          <input
            type="checkbox"
            checked={store.comparison.includes(r.hall.id)}
            disabled={
              !store.comparison.includes(r.hall.id) &&
              store.comparison.length >= 5
            }
            onChange={() => toggleCompare(r.hall.id)}
          />
          比較に追加
        </label>
        <details>
          <summary>
            根拠・出典・対象日 <Info size={13} />
          </summary>
          <div className="evidence">
            <p>{r.reasons.join("。")}</p>
            <p>
              対象期間の総差枚：{signed(r.total)}枚 ／ 充足率：{r.completeness}%
            </p>
            <p>
              直近3該当日−その前3該当日：{signed(r.trend)}枚 ／ 前年同条件平均：
              {signed(r.previousAvg)}枚
            </p>
            <p>
              データ更新：
              {new Date(r.updatedAt).toLocaleString("ja-JP", {
                timeZone: "Asia/Tokyo",
              })}
            </p>
            {Date.now() - Date.parse(r.updatedAt) > 7 * 86400000 && (
              <p className="warning">更新から7日以上経過しています</p>
            )}
            <p>
              対象日のイベント：
              {r.events.length
                ? r.events
                    .map(
                      (e) =>
                        `${e.name}（${e.status === "confirmed" ? "開催確認済み" : "告知のみ"}）`,
                    )
                    .join("、")
                : "未取得"}
            </p>
            {r.sources.map((s) => (
              <p key={s.id}>
                出典：
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.name}
                </a>
                ／{s.reliability}
                <br />
                {s.definition}
              </p>
            ))}
            <p className="date-list">
              対象日：{r.records.map((x) => x.date).join("、")}
            </p>
          </div>
        </details>
        <Link className="detail-link" href={`/halls/${r.hall.id}`}>
          詳細分析 <ArrowUpRight size={14} />
        </Link>
      </div>
    </article>
  );
}
