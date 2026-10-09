"use client";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Bookmark, ArrowLeft } from "lucide-react";
import { useApp, useAnalysis } from "./provider";
import { RankingCard, num, signed } from "./rankings";
import { SearchPanel } from "./search-panel";
import { holidayStreak, weekday } from "@/lib/calendar";
import type { Result } from "@/lib/types";
import { summarize } from "@/lib/metrics";
const TrendChart = dynamic(() => import("./chart"), { ssr: false });
const HallMap = dynamic(() => import("./map"), { ssr: false });
export type Unit = {
  hall_id: string;
  machine_id: string;
  machine_name: string;
  date: string;
  unit_number: string;
  diff: number | null;
  games: number | null;
  bb: number | null;
  reg: number | null;
  position: string | null;
};
type DetailData = {
  events: {
    id: string;
    date: string;
    name: string;
    status: string;
    source_url: string;
  }[];
  lottery: { id: number; date: string; kind: string; people: number }[];
  units: Unit[];
  installations: {
    name: string;
    valid_from: string;
    valid_to: string | null;
    units: number;
  }[];
};
export function Detail({ kind, id }: { kind: "hall" | "machine"; id: string }) {
  const { search, catalog, store, toggleFavorite } = useApp();
  const [tab, setTab] = useState("chart");
  const [detail, setDetail] = useState<DetailData | null>(null);
  const { data, error, loading } = useAnalysis({
    ...search,
    rankingMode: kind === "hall" ? "hall" : "machine",
    hallId: kind === "hall" ? id : "",
    machineIds: kind === "machine" ? [id] : [],
    bestOnly: false,
  });
  const entity =
    kind === "hall"
      ? catalog.halls.find((h) => h.id === id)
      : catalog.machines.find((m) => m.id === id);
  useEffect(() => {
    if (kind !== "hall") return;
    const c = new AbortController();
    setDetail(null);
    fetch(`/api/detail?mode=${search.mode}&hallId=${encodeURIComponent(id)}`, {
      signal: c.signal,
    })
      .then((r) => r.json())
      .then(setDetail)
      .catch(() => {});
    return () => c.abort();
  }, [id, kind, search.mode]);
  const records = data?.rankings.flatMap((r) => r.records) || [];
  const chart = useMemo(() => {
    const byDate = new Map<string, Result[]>();
    for (const r of data?.rankings.flatMap((r) => r.records) || []) {
      const group = byDate.get(r.date) || [];
      group.push(r);
      byDate.set(r.date, group);
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, rs]) => ({ date, avg: summarize(rs).avg }));
  }, [data]);
  const hall = kind === "hall" ? catalog.halls.find((h) => h.id === id) : null;
  const groups = (key: (r: Result) => string) => {
    const groups = new Map<string, Result[]>();
    for (const r of records) {
      const k = key(r);
      groups.set(k, [...(groups.get(k) || []), r]);
    }
    return [...groups.entries()].map(([name, rs]) => ({
      name,
      ...summarize(rs),
      days: new Set(rs.map((r) => r.date)).size,
    }));
  };
  return (
    <>
      <Link className="back-link" href="/">
        <ArrowLeft size={15} />
        検索結果に戻る
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {kind === "hall" ? "HALL INSIGHTS" : "MACHINE INSIGHTS"}
          </div>
          <h1>{entity?.name || "データ未登録"}</h1>
          <p>
            {kind === "hall"
              ? "設置機種と過去実績を、同じ条件で分析。"
              : "店舗を横断して、この機種の実績を比較。"}
          </p>
        </div>
        <button
          className="secondary-button"
          onClick={() => toggleFavorite(`${kind}:${id}`)}
        >
          <Bookmark size={16} />
          {store.favorites.includes(`${kind}:${id}`)
            ? "保存済み"
            : "お気に入り"}
        </button>
      </div>
      <SearchPanel />
      {error && <p className="error">{error}</p>}
      {hall && (
        <div className="detail-grid">
          <section className="panel info-panel">
            <h2>基本情報・アクセス</h2>
            <dl>
              {[
                ["住所", hall.address],
                ["営業時間", hall.hours],
                ["抽選時刻", hall.lottery_time],
                ["抽選場所", hall.lottery_place],
                ["抽選方式", hall.lottery_method],
                ["駐車場", hall.parking],
                ["経路・所要時間", null],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v || "未取得"}</dd>
                </div>
              ))}
            </dl>
            {hall.official_url && (
              <a href={hall.official_url} target="_blank" rel="noreferrer">
                公式サイト
              </a>
            )}
          </section>
          <section className="panel">
            <HallMap halls={[hall]} center={hall} radius={5} />
          </section>
        </div>
      )}
      <section className="panel info-panel">
        <div className="section-heading">
          <h2>過去実績の推移</h2>
          <div className="segmented">
            <button
              className={tab === "chart" ? "selected" : ""}
              onClick={() => setTab("chart")}
            >
              グラフ
            </button>
            <button
              className={tab === "table" ? "selected" : ""}
              onClick={() => setTab("table")}
            >
              表
            </button>
          </div>
        </div>
        <p className="muted">
          現在の検索条件に一致する収録データ。店舗の全台実績が揃っているとは限りません。
        </p>
        {!chart.length ? (
          <p className="empty-state">{loading ? "分析中…" : "データ不足"}</p>
        ) : tab === "chart" ? (
          <TrendChart rows={chart} />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>営業日</th>
                  <th>収録機種の加重平均差枚</th>
                </tr>
              </thead>
              <tbody>
                {chart.map((r) => (
                  <tr key={r.date}>
                    <td>{r.date}</td>
                    <td className={r.avg >= 0 ? "positive" : ""}>
                      {signed(r.avg)}枚
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="detail-grid">
        {[
          [
            "曜日別傾向",
            groups(
              (r) =>
                ["日", "月", "火", "水", "木", "金", "土"][weekday(r.date)],
            ),
          ],
          [
            "日付末尾別傾向",
            groups((r) => `${Number(r.date.slice(-2)) % 10}のつく日`),
          ],
          [
            "連休の位置別傾向",
            groups((r) => {
              const h = holidayStreak(r.date);
              return h.length < 3
                ? "連休以外"
                : h.position === "first"
                  ? "初日"
                  : h.position === "last"
                    ? "最終日"
                    : "中日";
            }),
          ],
        ].map(([title, rows]) => (
          <section className="panel info-panel" key={String(title)}>
            <h2>{String(title)}</h2>
            <table>
              <thead>
                <tr>
                  <th>条件</th>
                  <th>平均差枚</th>
                  <th>日数</th>
                </tr>
              </thead>
              <tbody>
                {(rows as ReturnType<typeof groups>).map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td className={r.avg >= 0 ? "positive" : ""}>
                      {signed(r.avg)}
                    </td>
                    <td>{r.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      <h2 className="spaced-heading">
        {kind === "hall" ? "機種別ランキング" : "店舗別ランキング"}
      </h2>
      {data?.rankings.map((r, i) => (
        <RankingCard item={r} index={i} key={`${r.hall.id}-${r.machine.id}`} />
      ))}
      {!loading && !data?.rankings.length && (
        <p className="empty-state panel">該当する実績データがありません</p>
      )}
      {detail && (
        <>
          <div className="detail-grid">
            <section className="panel info-panel">
              <h2>イベント履歴・予定</h2>
              {detail.events.length ? (
                detail.events.map((e) => (
                  <p key={e.id}>
                    {e.date}　{e.name}
                    <br />
                    <small className="muted">
                      {e.status === "confirmed"
                        ? "開催確認済み"
                        : e.status === "cancelled"
                          ? "中止"
                          : "告知のみ・開催未確認"}{" "}
                      {e.source_url && (
                        <a href={e.source_url} target="_blank" rel="noreferrer">
                          出典
                        </a>
                      )}
                    </small>
                  </p>
                ))
              ) : (
                <p>未取得</p>
              )}
            </section>
            <section className="panel info-panel">
              <h2>抽選人数</h2>
              <table>
                <thead>
                  <tr>
                    <th>日付</th>
                    <th>種別</th>
                    <th>人数</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lottery.map((r) => (
                    <tr key={r.id}>
                      <td>{r.date}</td>
                      <td>
                        {
                          {
                            actual: "実測",
                            forecast: "予測",
                            limit: "配布上限",
                            reported_average: "掲載平均",
                          }[r.kind]
                        }
                      </td>
                      <td>{num(r.people)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!detail.lottery.length && <p>未取得</p>}
            </section>
          </div>
          <section className="panel info-panel">
            <h2>設置台数・有効期間</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>機種</th>
                    <th>台数</th>
                    <th>有効期間</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.installations.map((r, i) => (
                    <tr key={i}>
                      <td>{r.name}</td>
                      <td>{r.units}</td>
                      <td>
                        {r.valid_from}〜{r.valid_to || "終了未登録"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted">
              CSV由来の台数は観測日のみ有効です。将来の設置台数として補完しません。
            </p>
          </section>
          <Link className="secondary-button" href={`/units?hall=${id}`}>
            台番別データを分析する →
          </Link>
        </>
      )}
    </>
  );
}
