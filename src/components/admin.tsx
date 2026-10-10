"use client";
import { useState } from "react";
import { Upload, Download, Database, CheckCircle2 } from "lucide-react";
import { useApp } from "./provider";
import { SourceWorkspace } from "./source-workspace";
export function Admin() {
  const { search, catalog, reload } = useApp();
  const [file, setFile] = useState<File | null>(null),
    [token, setToken] = useState(""),
    [verified, setVerified] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!file) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/import?mode=${search.mode}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "Content-Type": "text/csv",
        },
        body: await file.text(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage(
        `${data.rows}行を処理しました（採用実績の更新${data.changed}行・別出典として保存${data.retained}行）`,
      );
      setToken("");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "取込失敗");
      reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">DATA WORKSPACE</div>
          <h1>データを管理する</h1>
          <p>許諾済みのデータを、安全に取り込み・更新。</p>
        </div>
        <span className="status-badge">
          <Database size={15} />
          SQLite · {search.mode === "demo" ? "デモ用DB" : "実データ用DB"}
        </span>
      </div>
      <div className="detail-grid">
        <section className="panel info-panel">
          <h2>
            <Upload size={19} />
            CSVインポート
          </h2>
          <p className="muted">
            店舗・機種・日別実績をまとめて登録します。出典別に保持し、採用中の出典の訂正だけをランキングに反映します。
          </p>
          <form onSubmit={submit} className="import-form">
            <label className="upload-zone">
              <Upload size={28} />
              <strong>{file?.name || "CSVファイルを選択"}</strong>
              <span>UTF-8 · 最大2MB / 10,000行</span>
              <input
                aria-label="CSVファイル"
                type="file"
                accept=".csv,text/csv"
                required
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
            <div className="field">
              <label htmlFor="token">管理トークン</label>
              <input
                id="token"
                type="password"
                autoComplete="off"
                value={token}
                required
                onChange={(e) => setToken(e.target.value)}
              />
              <small>
                サーバーの ADMIN_IMPORT_TOKEN と一致する値。保存しません。
              </small>
            </div>
            <label className="consent">
              <input
                type="checkbox"
                required
                checked={verified}
                onChange={(e) => setVerified(e.target.checked)}
              />
              データの利用・転載許可と出典を確認しました
            </label>
            <button
              className="primary-button"
              disabled={busy || !verified || !file || !token}
            >
              {busy
                ? "取込中…"
                : `${search.mode === "demo" ? "デモ" : "実データ"}用DBに取り込む`}
            </button>
            {message && (
              <p className="success" role="status">
                <CheckCircle2 size={16} />
                {message}
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </form>
        </section>
        <section className="panel info-panel">
          <h2>CSVフォーマット</h2>
          <p>
            日付・店舗ID・機種が同じ別出典は個別に保存します。同じCSV内の重複は全体を差し戻します。
          </p>
          <p>
            プラス台数・平均ゲーム数は空欄可。それ以外は必須です。平均差枚は総差枚
            ÷ 対象台数で計算します。
          </p>
          <p>設置台数は観測日のみ有効として保存します。</p>
          <a
            className="secondary-button"
            href="/samples/demo-results.csv"
            download
          >
            <Download size={16} />
            デモ用サンプルCSV
          </a>
          <a
            className="secondary-button"
            href="/samples/real-template-v2.csv"
            download
          >
            <Download size={16} />
            実データ用テンプレート
          </a>
          <div className="notice">
            <strong>データを混在させません</strong>
            <p>
              data_kind が demo のCSVはデモ用DBにのみ取り込めます。実データは
              real を指定し、検証済みの値を入力してください。
            </p>
          </div>
        </section>
      </div>
      <SourceWorkspace />
      <section className="panel info-panel">
        <h2>更新・取込履歴</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>開始日時（日本時間）</th>
                <th>状態</th>
                <th>処理行数</th>
                <th>エラー</th>
              </tr>
            </thead>
            <tbody>
              {catalog.jobs.map((j) => (
                <tr key={j.id}>
                  <td>#{j.id}</td>
                  <td>
                    {new Date(j.started_at).toLocaleString("ja-JP", {
                      timeZone: "Asia/Tokyo",
                    })}
                  </td>
                  <td>
                    <span className={`job-status ${j.status}`}>
                      {j.status === "success"
                        ? "成功"
                        : j.status === "failed"
                          ? "失敗"
                          : "実行中"}
                    </span>
                  </td>
                  <td>{j.row_count}</td>
                  <td>{j.error || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!catalog.jobs.length && (
          <p className="muted">取込履歴はありません。</p>
        )}
        <p className="muted">
          修正したCSVを再取込すると再試行できます。許可済みHTTPS CSVの定期更新は
          npm run data:update で実行します。
        </p>
      </section>
      <section className="panel info-panel">
        <h2>データソース</h2>
        {catalog.sources.map((s) => (
          <div key={s.id} className="source-row">
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.name} ↗
            </a>
            <p>{s.permission}</p>
            <p>集計定義：{s.definition}</p>
            <small>
              {s.method} / {s.reliability} / 取得{" "}
              {new Date(s.retrieved_at).toLocaleString("ja-JP", {
                timeZone: "Asia/Tokyo",
              })}
            </small>
          </div>
        ))}
        {!catalog.sources.length && (
          <p className="muted">実データの出典はまだ登録されていません。</p>
        )}
      </section>
      <section className="panel info-panel" id="method">
        <h2>スコア算出方法</h2>
        <p>
          通常日は「平日、祝日でない、登録された旧特定日・イベントがない日」です。同機種の収録店舗横断の通常日平均を基準に、差枚のばらつき（最低200枚）で標準化します。
        </p>
        <table>
          <thead>
            <tr>
              <th>指標</th>
              <th>重み</th>
              <th>評価</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["通常日からの改善", "50%", "同機種基準の標準化差分（tanh）"],
              ["プラス台率", "15%", "50%を中立に評価"],
              ["平均ゲーム数", "10%", "6,000Gで上限"],
              ["安定性", "10%", "日ごとの平均差枚のばらつき"],
              ["直近傾向", "10%", "直近3該当日と、その前3該当日の差"],
              ["鮮度", "5%", "対象日からの日数で減衰"],
            ].map((r) => (
              <tr key={r[0]}>
                {r.map((c) => (
                  <td key={c}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          スコア = 50 + 50 × n/(n+8) ×
          指標の加重平均。0〜100に制限し、該当日3日未満・通常日3日未満は評価保留。欠損指標は除外して重みを再配分します。
        </p>
        <p>
          信頼度 = n/(n+8) × 充足率 × min(対象台数合計/100, 1) ×
          鮮度（365日減衰）。充足率は必須差枚・プラス台数・ゲーム数の取得率です。信頼度は統計的な勝率ではありません。
        </p>
        <p>
          曜日・特定日・連休は抽出条件として反映します。イベントは告知と開催確認を区別し、存在するだけでは加点しません。重みはMVPでは固定です。
        </p>
      </section>
    </>
  );
}
