"use client";
import { useState } from "react";
import { useApp } from "./provider";
// UI constants stay independent of SQLite/server modules.
const initial = {
  machine: 35,
  stability: 25,
  recent: 15,
  hall: 15,
  event: 10,
  bestShare: 65,
};
const names = {
  machine: "機種別出玉実績",
  stability: "好成績の安定性",
  recent: "直近傾向",
  hall: "ホール同条件実績",
  event: "イベント過去相関",
  bestShare: "ホール総合の最上位機種比率（残りはホール同条件）",
};
type Report = {
  count: number;
  held: number;
  topAvg: number | null;
  bottomAvg: number | null;
  difference: number | null;
  method: string;
  bands: { band: string; count: number; avg: number | null }[];
  dataVersion: string;
};
export function ScoreSettings() {
  const { search } = useApp();
  return <ScoreSettingsForm key={search.mode} />;
}
function ScoreSettingsForm() {
  const { search, reload } = useApp(),
    [weights, setWeights] = useState(initial),
    [token, setToken] = useState(""),
    [from, setFrom] = useState("2026-09-01"),
    [to, setTo] = useState("2026-09-30"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [reports, setReports] = useState<{
      current: Report;
      reference: Report;
    } | null>(null);
  async function request(body?: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(`/api/scoring?mode=${search.mode}`, {
        method: body ? "POST" : "GET",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      return d;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "失敗");
      return null;
    } finally {
      setBusy(false);
    }
  }
  const show = (n: number | null) =>
    n === null ? "評価不可" : `${Math.round(n).toLocaleString()}枚／台`;
  return (
    <section className="panel info-panel csv-workbench">
      <h2>期待度の配点・バックテスト</h2>
      <p>
        統計的な相対評価です。勝率・期待収支・高設定投入確率ではありません。設定はデモ／実データで別々に保存します。
      </p>
      <details>
        <summary>開発環境の管理トークン</summary>
        <input
          aria-label="採点設定用管理トークン"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </details>
      <button
        className="secondary-button"
        disabled={busy}
        onClick={async () => {
          const d = await request();
          if (d) setWeights(d.weights);
        }}
      >
        保存済み配点を読み込む
      </button>
      <div className="form-grid">
        {(Object.keys(initial) as (keyof typeof initial)[]).map((k) => (
          <label key={k}>
            {names[k]}（%）
            <input
              type="number"
              min="0"
              max="100"
              value={weights[k]}
              onChange={(e) =>
                setWeights({ ...weights, [k]: Number(e.target.value) })
              }
            />
          </label>
        ))}
      </div>
      <button
        className="primary-button"
        disabled={busy}
        onClick={async () => {
          const d = await request({ action: "weights", weights });
          if (d) {
            setMessage("配点を保存しました。次の検索から反映されます");
            reload();
          }
        }}
      >
        配点を保存
      </button>
      <h3>ウォークフォワード検証</h3>
      <p>
        現在の検索エリア・機種・日付条件と分析日数を使用します。検証期間は90日以内・60営業日まで。初期配点と入力中の配点を比較します。
      </p>
      <div className="form-grid">
        <label>
          検証開始日
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          検証終了日
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      <button
        className="primary-button"
        disabled={busy}
        onClick={async () => {
          const d = await request({
            action: "backtest",
            input: search,
            from,
            to,
            weights,
          });
          if (d) setReports(d);
        }}
      >
        {busy ? "処理中…" : "配点を比較検証する"}
      </button>
      {message && <p role="status">{message}</p>}
      {reports && (
        <>
          <p>{reports.current.method}</p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>配点</th>
                  <th>評価件数</th>
                  <th>評価保留</th>
                  <th>上位群平均</th>
                  <th>下位群平均</th>
                  <th>平均差</th>
                </tr>
              </thead>
              <tbody>
                {(["current", "reference"] as const).map((k) => (
                  <tr key={k}>
                    <td>{k === "current" ? "入力中の配点" : "初期配点"}</td>
                    <td>{reports[k].count}</td>
                    <td>{reports[k].held}</td>
                    <td>{show(reports[k].topAvg)}</td>
                    <td>{show(reports[k].bottomAvg)}</td>
                    <td>{show(reports[k].difference)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table>
              <thead>
                <tr>
                  <th>スコア帯</th>
                  <th>入力配点の件数</th>
                  <th>翌該当日平均</th>
                  <th>初期配点の件数</th>
                  <th>翌該当日平均</th>
                </tr>
              </thead>
              <tbody>
                {reports.current.bands.map((b, i) => (
                  <tr key={b.band}>
                    <td>{b.band}</td>
                    <td>{b.count}</td>
                    <td>{show(b.avg)}</td>
                    <td>{reports.reference.bands[i].count}</td>
                    <td>{show(reports.reference.bands[i].avg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small>
            検証バージョン {reports.current.dataVersion.slice(0, 16)}
          </small>
          {reports.current.count === 0 && (
            <p className="notice">
              評価できる過去データがありません。架空の検証結果は表示しません。
            </p>
          )}
        </>
      )}
    </section>
  );
}
