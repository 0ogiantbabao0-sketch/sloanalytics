"use client";
import { useEffect, useState } from "react";
import { useApp } from "./provider";
import {
  fields,
  kinds,
  kindLabels,
  type ImportKind,
} from "@/lib/csv-dictionary";
import type { ManagedSource } from "@/lib/managed-sources";
type Source = ManagedSource & {
  stats?: { last_attempt: string; last_success: string; errors: number };
  records?: { halls: number; days: number; records: number };
};
type History = {
  id: string;
  source_id: string;
  filename: string;
  status: string;
  row_count: number;
  created_at: string;
  error: string | null;
  summary_json: string | null;
};
type Data = {
  sources: Source[];
  history: History[];
  halls: { id: string; name: string }[];
  machines: { id: string; name: string }[];
};
type Staged = {
  id: string;
  headers: string[];
  encoding: string;
  delimiter: string;
  count: number;
  samples: { line: number; raw_json: string }[];
  mapping: Record<string, string>;
  formatChanged: boolean;
};
type ViewRow = {
  line: number;
  raw_json: string;
  status: string;
  messages_json: string;
  normalized_json: string | null;
};
const labels: Record<string, string> = {
  normal: "正常",
  warning: "警告あり",
  duplicate: "重複",
  review: "要確認",
  invalid: "登録不可",
};
const dateTime = (v: string | null | undefined) =>
  v
    ? new Date(v).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
    : "未取得";
const emptySource: ManagedSource = {
  id: "",
  name: "",
  url: "",
  category: "",
  method: "manual",
  enabled: true,
  priority: 100,
  storageAllowed: false,
  autoAllowed: false,
  permission: "",
  checkedAt: "",
  frequency: "手動",
};
export function CsvWorkbench() {
  const { search, reload } = useApp();
  return <Workbench key={search.mode} mode={search.mode} reload={reload} />;
}
function Workbench({
  mode,
  reload,
}: {
  mode: "demo" | "real";
  reload: () => void;
}) {
  const [token, setToken] = useState(""),
    [data, setData] = useState<Data>({
      sources: [],
      history: [],
      halls: [],
      machines: [],
    }),
    [source, setSource] = useState("min-repo"),
    [kind, setKind] = useState<ImportKind>("results"),
    [edit, setEdit] = useState<ManagedSource | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null),
    [encoding, setEncoding] = useState("auto"),
    [delimiter, setDelimiter] = useState("auto"),
    [staged, setStaged] = useState<Staged | null>(null),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [defaults, setDefaults] = useState<Record<string, string>>({
      data_kind: mode,
    }),
    [definition, setDefinition] = useState(
      "差枚は払出−投入、ゲーム数は1台平均。プラス台数は差枚が0より大きい台数。平均差枚の丸め値から総差枚を復元しない。",
    ),
    [confirmed, setConfirmed] = useState(false),
    [saveMapping, setSaveMapping] = useState(true),
    [counts, setCounts] = useState<Record<string, number> | null>(null),
    [rows, setRows] = useState<ViewRow[]>([]),
    [includeWarnings, setIncludeWarnings] = useState(false),
    [filter, setFilter] = useState(""),
    [offset, setOffset] = useState(0),
    [viewId, setViewId] = useState("");
  const [aliasEntity, setAliasEntity] = useState("hall");
  const base = `/api/workspace?mode=${mode}`;
  async function request(query: string, body?: unknown, raw?: File) {
    const res = await fetch(base + query, {
      method: body !== undefined || raw ? "POST" : "GET",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || "通信に失敗しました");
    return result;
  }
  async function load() {
    setData(await request(""));
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "処理失敗");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []); // Mode switches remount this workspace and clear staged operations.
  async function showRows(id: string, nextOffset = 0, nextFilter = "") {
    const result = await request(
      `&id=${id}&offset=${nextOffset}&status=${encodeURIComponent(nextFilter)}`,
    );
    setRows(result.rows);
    setViewId(id);
    setOffset(nextOffset);
    setFilter(nextFilter);
  }
  function resetPreview() {
    setCounts(null);
    setRows([]);
    setViewId("");
  }
  async function downloadErrors(id: string) {
    const r = await fetch(`${base}&id=${id}&download=errors`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) throw new Error("ダウンロードできません");
    const url = URL.createObjectURL(await r.blob()),
      a = document.createElement("a");
    a.href = url;
    a.download = "取込エラー.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const selected = data.sources.find((s) => s.id === source);
  const css = (status: string) =>
    status === "invalid" || status === "review" ? "error" : "muted";
  return (
    <section className="csv-workbench" aria-label="データ収集・管理">
      <div className="page-heading">
        <div>
          <div className="eyebrow">DATA COLLECTION</div>
          <h1>データ収集・管理</h1>
          <p>
            {mode === "demo" ? "DEMO専用" : "実データ専用"} ·
            CSVを確認してから登録します。
          </p>
        </div>
        <form action="/api/session?logout=1" method="post">
          <button className="secondary-button">ログアウト</button>
        </form>
      </div>
      <details className="panel info-panel">
        <summary>開発環境の管理トークン</summary>
        <p>本人用ログインが有効な公開環境では入力不要です。</p>
        <label>
          管理トークン（開発用）
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
        </label>
        <button className="secondary-button" onClick={() => action(load)}>
          管理情報を読み込む
        </button>
      </details>
      {error && (
        <p className="error panel info-panel" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success panel info-panel" role="status">
          {message}
        </p>
      )}
      <section className="panel info-panel">
        <h2>取得元サイト</h2>
        <p>参照先候補の登録は、CSV配布やデータ利用の許可を意味しません。</p>
        <button
          className="secondary-button"
          onClick={() => setEdit({ ...emptySource })}
        >
          取得元を追加
        </button>
        <div className="source-cards">
          {data.sources.map((s) => (
            <article className="source-card" key={s.id}>
              <strong>{s.name}</strong>
              <p>
                {s.enabled ? "有効" : "無効"} ·{" "}
                {s.method === "automatic"
                  ? "自動取得設定（実行は未接続）"
                  : "手動・CSV"}
              </p>
              <p>
                {s.storageAllowed
                  ? "保存利用の確認記録あり"
                  : "手動参照のみ・保存利用未確認"}{" "}
                / 自動取得{s.autoAllowed ? "許可記録あり" : "無効"}
              </p>
              <small>
                登録 {s.records?.records || 0}件 / {s.records?.halls || 0}店舗 /{" "}
                {s.records?.days || 0}日
              </small>
              <small>
                最終取得 {dateTime(s.stats?.last_attempt)}
                <br />
                最終成功 {dateTime(s.stats?.last_success)} / 解析失敗{" "}
                {s.stats?.errors || 0}件
              </small>
              <div className="button-row">
                <a
                  className="secondary-button"
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  参照先を開く
                </a>
                <button
                  className="secondary-button"
                  onClick={() => {
                    const { stats, records, ...config } = s;
                    setEdit(config);
                  }}
                >
                  設定
                </button>
                <button
                  className="secondary-button"
                  onClick={() =>
                    action(async () => {
                      await request("&action=automatic", { id: s.id });
                    })
                  }
                >
                  自動取得の状態確認
                </button>
              </div>
            </article>
          ))}
        </div>
        {edit && (
          <form
            className="import-form source-editor"
            onSubmit={(e) => {
              e.preventDefault();
              action(async () => {
                await request("&action=source", edit);
                await load();
                setSource(edit.id);
                setEdit(null);
                setMessage("取得元設定を保存しました");
              });
            }}
          >
            <h3>取得元設定</h3>
            {(
              [
                "id",
                "name",
                "url",
                "category",
                "frequency",
                "checkedAt",
              ] as const
            ).map((k) => (
              <label key={k}>
                {
                  {
                    id: "サイト識別ID",
                    name: "サイト名",
                    url: "サイトURL",
                    category: "情報種類",
                    frequency: "更新頻度",
                    checkedAt: "利用条件確認日",
                  }[k]
                }
                <input
                  type={
                    k === "checkedAt" ? "date" : k === "url" ? "url" : "text"
                  }
                  required={["id", "name", "url"].includes(k)}
                  value={edit[k]}
                  disabled={
                    k === "id" && data.sources.some((s) => s.id === edit.id)
                  }
                  onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}
                />
              </label>
            ))}
            <label>
              取得方法
              <select
                value={edit.method}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    method: e.target.value as ManagedSource["method"],
                  })
                }
              >
                <option value="manual">手動参照</option>
                <option value="csv">CSVアップロード</option>
                <option value="input">個別入力（従来画面）</option>
                <option value="automatic">自動取得設定（実行はPhase 3）</option>
              </select>
            </label>
            <label>
              優先度（小さいほど優先候補・自動上書きには使いません）
              <input
                type="number"
                min="0"
                max="10000"
                value={edit.priority}
                onChange={(e) =>
                  setEdit({ ...edit, priority: Number(e.target.value) })
                }
              />
            </label>
            <label>
              利用規約・許諾条件・記録
              <textarea
                required={edit.storageAllowed || edit.autoAllowed}
                value={edit.permission}
                onChange={(e) =>
                  setEdit({ ...edit, permission: e.target.value })
                }
                placeholder="規約URL、確認内容、許可範囲、契約番号など"
              />
            </label>
            {(["enabled", "storageAllowed", "autoAllowed"] as const).map(
              (k) => (
                <label className="consent" key={k}>
                  <input
                    type="checkbox"
                    checked={edit[k]}
                    onChange={(e) =>
                      setEdit({ ...edit, [k]: e.target.checked })
                    }
                  />
                  {
                    {
                      enabled: "有効にする",
                      storageAllowed:
                        "データ保存・本人用分析への再利用許可を確認済み",
                      autoAllowed: "自動取得の正式な許可を確認済み",
                    }[k]
                  }
                </label>
              ),
            )}
            <div className="button-row">
              <button className="primary-button" disabled={busy}>
                取得元設定を保存
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setEdit(null)}
              >
                閉じる
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await request("&action=delete-source", { id: edit.id });
                    setEdit(null);
                    await load();
                  })
                }
              >
                未使用の取得元を削除
              </button>
            </div>
          </form>
        )}
      </section>
      <section className="panel info-panel">
        <h2>CSVインポート</h2>
        <ol className="import-steps">
          <li>取得元</li>
          <li>ファイル</li>
          <li>列の対応</li>
          <li>プレビュー・検証</li>
          <li>登録・結果</li>
        </ol>
        <fieldset disabled={busy}>
          <div className="form-grid">
            <label>
              取得元
              <select
                aria-label="CSV取得元"
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  setStaged(null);
                  resetPreview();
                }}
              >
                {data.sources.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              CSV種別
              <select
                aria-label="CSV種別"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as ImportKind);
                  setStaged(null);
                  resetPreview();
                }}
              >
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {kindLabels[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              文字コード
              <select
                value={encoding}
                onChange={(e) => setEncoding(e.target.value)}
              >
                <option value="auto">自動判定（プレビューで確認）</option>
                <option value="utf-8">UTF-8 / BOM</option>
                <option value="shift_jis">Shift_JIS / CP932</option>
              </select>
            </label>
            <label>
              区切り文字
              <select
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value)}
              >
                <option value="auto">自動判定</option>
                <option value=",">カンマ</option>
                <option value={"\t"}>タブ</option>
                <option value=";">セミコロン</option>
              </select>
            </label>
          </div>
          <label
            className="upload-zone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setFile(e.dataTransfer.files[0] || null);
              setStaged(null);
              resetPreview();
            }}
          >
            <strong>
              {file?.name || "CSV / TSVを選択、またはここにドロップ"}
            </strong>
            <input
              type="file"
              aria-label="マッピング用CSV"
              accept=".csv,.tsv"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setStaged(null);
                resetPreview();
              }}
            />
          </label>
          <p className="muted">
            標準上限20MB・100,000行。ExcelはCSVで保存してください。文字コードや区切りの変更後は再解析してください。
          </p>
          <button
            className="primary-button"
            disabled={!file || !selected?.storageAllowed || !selected?.enabled}
            onClick={() =>
              action(async () => {
                if (!file) return;
                const params = new URLSearchParams({
                  action: "upload",
                  source,
                  kind,
                  filename: file.name,
                  encoding,
                  delimiter,
                });
                const result = await request(
                  "&" + params.toString(),
                  undefined,
                  file,
                );
                setStaged(result);
                setMapping(result.mapping);
                setDefaults({
                  data_kind: mode,
                  source_url: selected?.url || "",
                });
                setConfirmed(false);
                resetPreview();
                await load();
              })
            }
          >
            ファイルを解析
          </button>
          {!selected?.storageAllowed && (
            <p className="notice">
              先に取得元の設定で、保存・利用条件の確認記録を登録してください。
            </p>
          )}
        </fieldset>
        {staged && (
          <div className="import-form">
            <h3>列の対応を確認</h3>
            <p>
              {staged.count}行 · {staged.encoding} · 区切り{" "}
              {staged.delimiter === "\t" ? "タブ" : staged.delimiter}
            </p>
            {staged.formatChanged && (
              <p role="alert" className="notice">
                前回とヘッダーが異なります。保存済みマッピングを自動適用していません。
              </p>
            )}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>CSVの列</th>
                    <th>サンプル</th>
                    <th>対応する項目</th>
                  </tr>
                </thead>
                <tbody>
                  {staged.headers.map((h, i) => (
                    <tr key={h}>
                      <td>{h}</td>
                      <td>
                        {staged.samples
                          .slice(0, 2)
                          .map((s) => JSON.parse(s.raw_json)[i])
                          .join(" / ")}
                      </td>
                      <td>
                        <select
                          aria-label={`列 ${h}`}
                          value={mapping[h] || ""}
                          onChange={(e) => {
                            setMapping({ ...mapping, [h]: e.target.value });
                            resetPreview();
                          }}
                        >
                          <option value="">取り込まない</option>
                          {Object.entries(fields).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>CSVにない共通値</h3>
            <p className="muted">
              CSVに対応列がある場合は、その列の値が優先されます。空欄をゼロに変換しません。
            </p>
            <div className="form-grid">
              {["data_kind", "hall_id", "date", "source_url"].map((k) => (
                <label key={k}>
                  {fields[k]}
                  <input
                    value={defaults[k] || ""}
                    onChange={(e) => {
                      setDefaults({ ...defaults, [k]: e.target.value });
                      resetPreview();
                    }}
                  />
                </label>
              ))}
            </div>
            <label>
              列の定義・集計範囲・変換根拠
              <textarea
                value={definition}
                onChange={(e) => {
                  setDefinition(e.target.value);
                  resetPreview();
                }}
              />
            </label>
            <label className="consent">
              <input
                type="checkbox"
                checked={saveMapping}
                onChange={(e) => setSaveMapping(e.target.checked)}
              />
              この取得元・CSV種別のマッピングを保存する
            </label>
            <label className="consent">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => {
                  setConfirmed(e.target.checked);
                  resetPreview();
                }}
              />
              列の意味、正規化の方針、出典と保存利用条件を確認しました
            </label>
            <button
              className="primary-button"
              disabled={busy || !confirmed}
              onClick={() =>
                action(async () => {
                  const result = await request("&action=preview", {
                    id: staged.id,
                    config: {
                      mapping,
                      defaults,
                      definition,
                      confirmed,
                      saveMapping,
                    },
                  });
                  setCounts(result);
                  await showRows(staged.id);
                })
              }
            >
              プレビュー・検証する
            </button>
          </div>
        )}
        {counts && (
          <div className="import-form">
            <h3>検証結果</h3>
            <div className="button-row">
              {Object.entries(counts).map(([k, v]) => (
                <span className="status-badge" key={k}>
                  {labels[k]} {v}件
                </span>
              ))}
            </div>
            <label className="consent">
              <input
                type="checkbox"
                checked={includeWarnings}
                onChange={(e) => setIncludeWarnings(e.target.checked)}
              />
              補正内容・警告を確認し、「警告あり」の行も登録する
            </label>
            <p>
              正常行{counts.normal}件
              {includeWarnings ? `＋警告行${counts.warning}件` : ""}
              を登録します。重複・要確認・登録不可の行は除外します。
            </p>
            <button
              className="primary-button"
              disabled={
                busy || (!counts.normal && !(includeWarnings && counts.warning))
              }
              onClick={() =>
                action(async () => {
                  const result = await request("&action=commit", {
                    id: staged!.id,
                    confirm: true,
                    includeWarnings,
                  });
                  setMessage(
                    `登録${result.inserted}件・更新${result.updated}件・別出典保存${result.retained}件・重複${result.duplicate}件・除外${result.excluded}件・失敗${result.failed}件。${result.analysis}`,
                  );
                  setCounts(null);
                  setStaged(null);
                  await load();
                  reload();
                })
              }
            >
              確認した行をDB登録
            </button>
          </div>
        )}
      </section>
      {viewId && (
        <section className="panel info-panel">
          <h2>行ごとの確認</h2>
          <div className="button-row">
            <select
              aria-label="検証状態フィルター"
              value={filter}
              onChange={(e) =>
                action(() => showRows(viewId, 0, e.target.value))
              }
            >
              <option value="">すべて</option>
              {Object.entries(labels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <button
              className="secondary-button"
              onClick={() => action(() => downloadErrors(viewId))}
            >
              エラー行CSV
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>レコード番号</th>
                  <th>状態</th>
                  <th>データ</th>
                  <th>確認事項・補正内容</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td className={css(r.status)}>
                      {labels[r.status] || "未検証"}
                    </td>
                    <td>
                      <details>
                        <summary>
                          {r.normalized_json
                            ? Object.values(JSON.parse(r.normalized_json))
                                .slice(0, 5)
                                .join(" / ")
                            : JSON.parse(r.raw_json).slice(0, 4).join(" / ")}
                        </summary>
                        <pre>
                          {r.normalized_json
                            ? JSON.stringify(
                                JSON.parse(r.normalized_json),
                                null,
                                2,
                              )
                            : r.raw_json}
                        </pre>
                      </details>
                    </td>
                    <td>
                      {r.messages_json
                        ? JSON.parse(r.messages_json).join(" / ")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="button-row">
            <button
              className="secondary-button"
              disabled={busy || offset === 0}
              onClick={() =>
                action(() =>
                  showRows(viewId, Math.max(0, offset - 100), filter),
                )
              }
            >
              前の100行
            </button>
            <span>{offset + 1}行目から表示</span>
            <button
              className="secondary-button"
              disabled={busy || rows.length < 100}
              onClick={() =>
                action(() => showRows(viewId, offset + 100, filter))
              }
            >
              次の100行
            </button>
          </div>
        </section>
      )}
      <details className="panel info-panel">
        <summary>CSV用の店舗・機種別名を登録</summary>
        <p>
          ID・住所・型式を確認し、同一と判断できた場合だけ登録してください。
        </p>
        <form
          className="import-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            action(async () => {
              await request("&action=alias", {
                source,
                entity: aliasEntity,
                alias: f.get("alias"),
                canonical_id: f.get("canonical_id"),
                evidence: f.get("evidence"),
              });
              setMessage(
                "別名を登録しました。CSVのプレビューを再実行してください",
              );
              resetPreview();
            });
          }}
        >
          <p>取得元：{selected?.name}</p>
          <label>
            対象
            <select
              value={aliasEntity}
              onChange={(e) => setAliasEntity(e.target.value)}
            >
              <option value="hall">店舗</option>
              <option value="machine">機種</option>
            </select>
          </label>
          <label>
            CSV上の別名
            <input name="alias" required />
          </label>
          <label>
            対応するマスタ
            <select name="canonical_id" required>
              {(aliasEntity === "hall" ? data.halls : data.machines).map(
                (v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}（{v.id}）
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            同一と判断した根拠
            <input name="evidence" required />
          </label>
          <button className="secondary-button" disabled={busy}>
            別名を登録
          </button>
        </form>
      </details>
      <section className="panel info-panel">
        <h2>インポート履歴</h2>
        <p>
          最新100件。未解決の別出典は採用値を上書きせず保存します。取り消し・競合解決画面はPhase
          2です。
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>実行日時（日本時間）</th>
                <th>ファイル / 取得元</th>
                <th>状態</th>
                <th>結果</th>
                <th>確認</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((h) => (
                <tr key={h.id}>
                  <td>{dateTime(h.created_at)}</td>
                  <td>
                    {h.filename}
                    <br />
                    {h.source_id}
                  </td>
                  <td>{h.status}</td>
                  <td>
                    {h.row_count}行
                    {h.error && <p className="error">{h.error}</p>}
                    {h.summary_json && (
                      <details>
                        <summary>件数内訳</summary>
                        <pre>
                          {JSON.stringify(JSON.parse(h.summary_json), null, 2)}
                        </pre>
                      </details>
                    )}
                  </td>
                  <td>
                    <button
                      className="secondary-button"
                      onClick={() => action(() => showRows(h.id))}
                    >
                      行を確認
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel info-panel">
        <h2>CSVテンプレート・サンプル</h2>
        <div className="button-row">
          {kinds.map((k) => (
            <a
              key={k}
              href={`/samples/${k}-template.csv`}
              download
              className="secondary-button"
            >
              {kindLabels[k]}
            </a>
          ))}
          <a
            href="/samples/phase1-demo.zip"
            className="secondary-button"
            download
          >
            DEMOサンプル3種類
          </a>
        </div>
        <p>
          ホール基本情報 →
          設置機種・日次実績の順に登録します。未知の店舗や曖昧な機種は勝手に結合しません。
        </p>
      </section>
    </section>
  );
}
