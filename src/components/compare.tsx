"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp, useAnalysis } from "./provider";
import { num, signed } from "./rankings";
import { SearchPanel } from "./search-panel";
export function Compare() {
  const { search, catalog, store, toggleCompare } = useApp();
  const [machine, setMachine] = useState("");
  useEffect(() => {
    if (!catalog.machines.some((m) => m.id === machine))
      setMachine(catalog.machines[0]?.id || "");
  }, [catalog.machines, machine]);
  const { data, error } = useAnalysis({
    ...search,
    rankingMode: "machine",
    machineIds: machine ? [machine] : [],
    bestOnly: false,
  });
  const halls = catalog.halls.filter((h) => store.comparison.includes(h.id));
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SIDE BY SIDE</div>
          <h1>同じ条件で、ホールを比較。</h1>
          <p>2〜5店舗を選択。同一機種・日付条件で比較します。</p>
        </div>
      </div>
      <SearchPanel />
      <section className="panel info-panel">
        <h2>比較する店舗と機種</h2>
        <div className="chips">
          {catalog.halls.map((h) => (
            <label
              key={h.id}
              className={`chip ${store.comparison.includes(h.id) ? "chosen" : ""}`}
            >
              <input
                type="checkbox"
                checked={store.comparison.includes(h.id)}
                disabled={
                  !store.comparison.includes(h.id) &&
                  store.comparison.length >= 5
                }
                onChange={() => toggleCompare(h.id)}
              />
              {h.name}
            </label>
          ))}
        </div>
        <select
          aria-label="比較する機種"
          value={machine}
          onChange={(e) => setMachine(e.target.value)}
        >
          {catalog.machines.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </section>
      {halls.length < 2 ? (
        <div className="empty-state panel">
          比較するホールを2店舗以上選択してください。
        </div>
      ) : (
        <section className="panel info-panel">
          <p className="muted">
            {data?.from}〜{data?.to} ／{" "}
            {catalog.machines.find((m) => m.id === machine)?.name} ／ 半径
            {search.radius}km・共通の条件で集計
          </p>
          {error && <p className="error">{error}</p>}
          <div className="table-scroll">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>指標</th>
                  {halls.map((h) => (
                    <th key={h.id}>
                      <Link href={`/halls/${h.id}`}>{h.name}</Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  "総合スコア",
                  "平均差枚",
                  "プラス台率",
                  "サンプル日数",
                  "信頼度",
                  "平均ゲーム数",
                  "距離",
                ].map((label, i) => (
                  <tr key={label}>
                    <th>{label}</th>
                    {halls.map((h) => {
                      const r = data?.rankings.find((r) => r.hall.id === h.id);
                      return (
                        <td key={h.id}>
                          {!r
                            ? "データ不足／範囲外"
                            : [
                                r.score === null ? "評価保留" : `${r.score}点`,
                                `${signed(r.avg)}枚`,
                                r.positiveRate === null
                                  ? "未取得"
                                  : `${num(r.positiveRate, 1)}%`,
                                `${r.days}日`,
                                `${r.confidence}%`,
                                r.games === null
                                  ? "未取得"
                                  : `${num(r.games)}G`,
                                `${r.distance.toFixed(1)}km`,
                              ][i]}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
