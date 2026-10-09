"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowRight,
  Building2,
  Layers3,
  CalendarDays,
  CircleHelp,
  MapPin,
} from "lucide-react";
import { useApp, useAnalysis } from "./provider";
import { SearchPanel } from "./search-panel";
import { RankingCard } from "./rankings";
const HallMap = dynamic(() => import("./map"), {
  ssr: false,
  loading: () => <div className="map-canvas skeleton" />,
});
export function Dashboard() {
  const { search, setSearch, store, setStore } = useApp();
  const { data, error, loading } = useAnalysis(search);
  const [selected, setSelected] = useState("");
  const halls = useMemo(
    () => [
      ...new Map(data?.rankings.map((r) => [r.hall.id, r.hall]) || []).values(),
    ],
    [data],
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">EXPLORE & ANALYZE</div>
          <h1>次の一台を、データから。</h1>
          <p>ホールと機種の過去実績を、あなたの条件で比較。</p>
        </div>
        <div className="heading-date">
          <CalendarDays size={18} />
          <span>
            {search.targetDate.replaceAll("-", " / ")}
            <small>
              {data?.streak.length && data.streak.length >= 3
                ? `${data.streak.length}連休・${data.streak.index}日目`
                : data?.targetHoliday || "分析対象日"}
            </small>
          </span>
        </div>
      </div>
      <SearchPanel />
      <div className="summary-grid">
        <div className="summary-card">
          <span className="summary-icon blue">
            <Building2 size={20} />
          </span>
          <div>
            <small>検索範囲内のホール</small>
            <b>
              {data?.hallCount ?? "—"}
              <em>店舗</em>
            </b>
          </div>
        </div>
        <div className="summary-card">
          <span className="summary-icon purple">
            <Layers3 size={20} />
          </span>
          <div>
            <small>評価対象の組み合わせ</small>
            <b>
              {data?.eligibleCount ?? "—"}
              <em>件</em>
            </b>
          </div>
        </div>
        <div className="summary-card">
          <span className="summary-icon green">
            <CalendarDays size={20} />
          </span>
          <div>
            <small>分析対象期間</small>
            <b>
              {search.from ? "任意" : search.days}
              <em>{search.from ? "期間" : "日間"}</em>
            </b>
          </div>
        </div>
        <div className="summary-card">
          <span className="summary-icon amber">
            <MapPin size={20} />
          </span>
          <div>
            <small>{search.center.name}から</small>
            <b>
              {search.radius}
              <em>km 圏内</em>
            </b>
          </div>
        </div>
      </div>
      <div className="results-layout">
        <section>
          <div className="section-heading">
            <div>
              <h2>
                ホール × 機種ランキング{" "}
                <span>{data?.rankings.length ?? 0}</span>
              </h2>
              <p>
                {data
                  ? `${data.from} 〜 ${data.to} の過去実績`
                  : "検索条件に基づいて計算します"}
              </p>
            </div>
            <select
              aria-label="並び替え"
              value={search.sort}
              onChange={(e) => setSearch({ ...search, sort: e.target.value })}
            >
              {[
                ["score", "総合スコア順"],
                ["avg", "平均差枚順"],
                ["positiveRate", "プラス台率順"],
                ["confidence", "信頼度順"],
                ["days", "サンプル日数順"],
                ["distance", "距離が近い順"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <label className="best-only">
            <input
              type="checkbox"
              checked={search.bestOnly}
              onChange={(e) =>
                setSearch({ ...search, bestOnly: e.target.checked })
              }
            />
            各ホールの最上位機種のみ表示
          </label>
          {loading ? (
            <div className="empty-state panel">分析中…</div>
          ) : error ? (
            <div role="alert" className="error panel">
              {error}
            </div>
          ) : !data?.rankings.length ? (
            <div className="empty-state panel">
              <Layers3 size={30} />
              <h3>該当する実績データがありません</h3>
              <p>
                検索範囲・条件を変更するか、CSVで実績を登録してください。
                <br />
                データがない条件のランキングは生成しません。
              </p>
              <Link href="/admin">
                データ管理へ <ArrowRight size={14} />
              </Link>
            </div>
          ) : (
            data.rankings.map((r, i) => (
              <RankingCard
                key={`${r.hall.id}-${r.machine.id}`}
                item={r}
                index={i}
                selected={selected === r.hall.id}
                onSelect={() => setSelected(r.hall.id)}
              />
            ))
          )}
          {store.comparison.length > 0 && (
            <div className="compare-bar">
              <span>{store.comparison.length}店舗を選択中</span>
              <Link href="/compare">
                同じ条件で比較する <ArrowRight size={16} />
              </Link>
            </div>
          )}
        </section>
        <aside className="results-aside">
          <div className="panel map-panel">
            <div className="panel-title">
              <span>
                <MapPin size={17} />
                エリアマップ
              </span>
              <small>{halls.length}店舗</small>
            </div>
            <HallMap
              halls={halls}
              center={search.center}
              radius={search.radius}
              selected={selected}
              onSelect={(id) => {
                setSelected(id);
                document
                  .querySelector(`[id^="hall-${id}-"]`)
                  ?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              onCenter={(lat, lng) =>
                setSearch({
                  ...search,
                  center: { name: "地図で指定した地点", lat, lng },
                })
              }
            />
            <div className="map-caption">
              地図をタップして中心地を変更
              <br />
              半径はハバーサイン式による直線距離です。
            </div>
            <button
              className="text-button save-place"
              onClick={() =>
                setStore({
                  ...store,
                  places: [
                    ...store.places,
                    {
                      ...search.center,
                      name: `保存地点 ${store.places.length + 1}（${search.center.lat.toFixed(3)}, ${search.center.lng.toFixed(3)}）`,
                    },
                  ],
                })
              }
            >
              この中心地を保存
            </button>
            <p className="map-caption">所要時間・経路距離：未取得</p>
          </div>
          <div className="method-card">
            <CircleHelp size={20} />
            <h3>スコアの見かた</h3>
            <p>
              同機種の通常日との差、プラス台率、稼働、安定性、直近実績を組み合わせて評価。
            </p>
            <div className="score-scale">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="scale-label">
              <span>低い</span>
              <span>相対評価 0–100</span>
              <span>高い</span>
            </div>
            <p>
              サンプルが少ないほど中立値へ補正。信頼度はスコアとは別に表示します。
            </p>
            <Link href="/admin#method">
              算出方法を確認 <ArrowUp />
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}
function ArrowUp() {
  return <ArrowRight size={14} />;
}
