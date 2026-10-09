"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useApp } from "./provider";
import type { Unit } from "./detail";
import { num, signed } from "./rankings";
export function Units() {
  const { catalog, search } = useApp();
  const params = useSearchParams();
  const [hallId, setHallId] = useState(params.get("hall") || "");
  const [rows, setRows] = useState<Unit[]>([]);
  const [date, setDate] = useState("");
  const [machine, setMachine] = useState("");
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!catalog.halls.some((h) => h.id === hallId))
      setHallId(catalog.halls[0]?.id || "");
  }, [catalog.halls, hallId]);
  useEffect(() => {
    setRows([]);
    if (!hallId) return;
    const c = new AbortController();
    setError("");
    fetch(
      `/api/detail?mode=${search.mode}&hallId=${encodeURIComponent(hallId)}`,
      { signal: c.signal },
    )
      .then((r) => r.json())
      .then((d) => {
        setRows(d.units);
        setDate(d.units[0]?.date || "");
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError("取得に失敗しました");
      });
    return () => c.abort();
  }, [hallId, search.mode]);
  const filtered = rows.filter(
    (r) => (!date || r.date === date) && (!machine || r.machine_id === machine),
  );
  const history = rows.filter(
    (r) => r.unit_number === selected && (!machine || r.machine_id === machine),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">UNIT EXPLORER</div>
          <h1>台番ごとの実績を見る</h1>
          <p>
            取得済みの台番データのみ表示。位置・設定・投入法則は推定しません。
          </p>
        </div>
      </div>
      <section className="panel info-panel">
        <div className="search-grid">
          <div className="field">
            <label>ホール</label>
            <select
              aria-label="台番分析のホール"
              value={hallId}
              onChange={(e) => setHallId(e.target.value)}
            >
              {catalog.halls.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>営業日</label>
            <select
              aria-label="台番分析の営業日"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            >
              {[...new Set(rows.map((r) => r.date))].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>機種</label>
            <select
              aria-label="台番分析の機種"
              value={machine}
              onChange={(e) => setMachine(e.target.value)}
            >
              <option value="">全機種</option>
              {catalog.machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <h2>差枚ヒートマップ</h2>
        <p className="muted">
          緑＝プラス、薄赤＝マイナス、グレー＝未取得。台番号をタップすると履歴を表示します。
        </p>
        <div className="heatmap">
          {filtered.map((r) => (
            <button
              key={`${r.date}-${r.unit_number}`}
              className={`${r.diff === null ? "unknown" : r.diff >= 0 ? "plus" : "minus"} ${selected === r.unit_number ? "selected" : ""}`}
              onClick={() => setSelected(r.unit_number)}
            >
              <small>台 {r.unit_number}</small>
              <b>{signed(r.diff)}</b>
              <span>{r.machine_name}</span>
            </button>
          ))}
        </div>
        {!filtered.length && (
          <p className="empty-state">台番別データは未取得です。</p>
        )}
      </section>
      {selected && (
        <section className="panel info-panel">
          <h2>台番号 {selected} の履歴</h2>
          <p className="muted">
            サンプル {history.length}日 ／ プラス率{" "}
            {history.filter((r) => r.diff !== null).length
              ? num(
                  (history.filter((r) => (r.diff ?? 0) > 0).length /
                    history.filter((r) => r.diff !== null).length) *
                    100,
                  1,
                ) + "%"
              : "未取得"}{" "}
            ／ 投入傾向：不明
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>日付</th>
                  <th>機種</th>
                  <th>差枚</th>
                  <th>ゲーム数</th>
                  <th>BB</th>
                  <th>REG</th>
                  <th>BB確率</th>
                  <th>REG確率</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.date}>
                    <td>{r.date}</td>
                    <td>{r.machine_name}</td>
                    <td>{signed(r.diff)}</td>
                    <td>{num(r.games)}</td>
                    <td>{num(r.bb)}</td>
                    <td>{num(r.reg)}</td>
                    <td>
                      {r.games && r.bb
                        ? `1/${num(r.games / r.bb, 1)}`
                        : "未取得"}
                    </td>
                    <td>
                      {r.games && r.reg
                        ? `1/${num(r.games / r.reg, 1)}`
                        : "未取得"}
                    </td>
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
