"use client";
import { useState } from "react";
import { Upload, Download, Database, CheckCircle2 } from "lucide-react";
import { useApp } from "./provider";
import { ScoreSettings } from "./score-settings";
import { CsvWorkbench } from "./csv-workbench";
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
      <CsvWorkbench />
      <ScoreSettings />
      <details>
        <summary>従来の固定形式CSV・個別登録・出典管理</summary>
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
            修正したCSVを再取込すると再試行できます。許可済みHTTPS
            CSVの定期更新は npm run data:update で実行します。
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
          <h2>期待度の算出方法</h2>
          <p>
            機種別出玉35%、安定性25%、直近傾向15%、ホール同条件15%、イベント過去相関10%が初期配点です。上部の設定で変更できます。
          </p>
          <p>
            通常日は平日・非祝日で、旧特定日とイベントのない日。同機種の通常日との差を標準化し、n/(n+8)で少数サンプルを補正します。該当3日未満または通常日3日未満は評価保留です。
          </p>
          <p>
            ホール総合は最上位機種65%・ホール同条件35%。最上位点には日数と収録機種内の条件充足率の補正を適用します。未解決の競合は除外し、詳細はランキングの「期待度の内訳」で確認できます。
          </p>
        </section>
      </details>
    </>
  );
}
