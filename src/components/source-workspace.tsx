"use client";
import { useEffect, useState } from "react";
import { useApp } from "./provider";
import {
  sourceCandidates,
  STANDARD_DEFINITION,
  DEFINITION_CODE,
} from "@/lib/source-catalog";

type Observation = {
  id: number;
  date: string;
  hall_name: string;
  machine_name: string;
  source_name: string;
  source_url: string;
  permission: string;
  definition: string;
  retrieved_at: string;
  imported_at: string;
  published_at: string | null;
  source_updated_at: string | null;
  payload_json: string;
  selected: number;
  selected_total_diff: number;
  raw_hall_name: string;
  raw_machine_name: string;
  method: string;
};
type Mapping = {
  provider_id: string;
  entity: string;
  alias: string;
  canonical_id: string;
  evidence: string;
};
const dateTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
    : "未取得";
const manualFields = [
  ["hall_id", "店舗ID", "text"],
  ["hall_name", "店舗名", "text"],
  ["address", "住所", "text"],
  ["lat", "緯度", "number"],
  ["lng", "経度", "number"],
  ["machine_name", "機種名", "text"],
  ["date", "営業日", "date"],
  ["units", "対象台数", "number"],
  ["total_diff", "総差枚", "number"],
  ["positive_units", "プラス台数（未取得なら空欄）", "number"],
  ["games", "平均ゲーム数（未取得なら空欄）", "number"],
  ["source_name", "出典名", "text"],
  ["source_url", "出典の公開URL", "url"],
  ["permission", "許可根拠・契約の参照番号", "text"],
  [
    "retrieved_at",
    "取得日時（タイムゾーン付きISO形式・空欄は登録時刻）",
    "text",
  ],
  ["published_at", "公開日時（タイムゾーン付きISO形式・任意）", "text"],
  [
    "source_updated_at",
    "提供元の更新日時（タイムゾーン付きISO形式・任意）",
    "text",
  ],
] as const;
function ProviderSelect({
  id,
  name = "provider_id",
}: {
  id: string;
  name?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>取得元</label>
      <select id={id} name={name} defaultValue="user">
        <option value="user">自分・許諾済みの提供者</option>
        {sourceCandidates.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SourceWorkspace() {
  const { search, catalog, reload } = useApp();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [entity, setEntity] = useState("hall");
  const [review, setReview] = useState<{
    observations: Observation[];
    mappings: Mapping[];
  } | null>(null);
  useEffect(() => {
    setReview(null);
    setMessage("");
    setError("");
    setToken("");
  }, [search.mode]);
  async function request(path: string, body?: unknown) {
    const res = await fetch(`${path}?mode=${search.mode}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    return result;
  }
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setReview(await request("/api/source-management"));
  }
  function manual(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const row = Object.fromEntries(new FormData(form).entries());
    delete row.consent;
    void perform(async () => {
      const result = await request("/api/import", {
        rows: [
          { ...row, data_kind: search.mode, definition_code: DEFINITION_CODE },
        ],
      });
      setMessage(
        `手動登録しました。採用実績の更新${result.changed}件・別出典として保存${result.retained}件。`,
      );
      await refresh();
    });
  }
  function mapping(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = Object.fromEntries(new FormData(e.currentTarget).entries());
    void perform(async () => {
      await request("/api/source-management", {
        action: "mapping",
        mapping: value,
      });
      setMessage("取得元ごとの別名を登録しました。");
      await refresh();
    });
  }
  return (
    <section className="panel info-panel source-workspace">
      <h2>出典を照合・登録する</h2>
      <p>
        同じ店舗・機種・営業日の実績を複数の出典から保存できます。ランキングには採用した1件だけを使い、別出典を足し合わせません。
      </p>
      <div className="field">
        <label htmlFor="source-token">出典管理トークン</label>
        <input
          id="source-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            setReview(null);
          }}
        />
        <small>
          管理者だけが登録・名寄せ・採用先の変更を行えます。トークンは保存しません。
        </small>
      </div>
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <details>
        <summary>日別機種実績を手動登録</summary>
        <p>
          許可されたデータを1件ずつ入力します。既存店舗は登録済みIDと住所・座標を使用してください。取得元を選ぶだけで利用許諾を得たことにはなりません。
        </p>
        <form onSubmit={manual} className="import-form">
          <div className="source-form-grid">
            <ProviderSelect id="manual-provider" />
            {manualFields.map(([key, label, type]) => (
              <div className="field" key={key}>
                <label htmlFor={`manual-${key}`}>{label}</label>
                <input
                  id={`manual-${key}`}
                  name={key}
                  type={type}
                  step={type === "number" ? "any" : undefined}
                  required={
                    ![
                      "positive_units",
                      "games",
                      "retrieved_at",
                      "published_at",
                      "source_updated_at",
                    ].includes(key)
                  }
                />
              </div>
            ))}
          </div>
          <div className="field">
            <label htmlFor="manual-definition">集計定義・対象範囲</label>
            <textarea
              id="manual-definition"
              name="definition"
              defaultValue={STANDARD_DEFINITION}
              required
              maxLength={1000}
            />
          </div>
          <p className="muted">
            差枚は払出−投入、ゲーム数は1台平均、プラス台数は差枚が0より大きい台数に統一します。異なる定義のまま登録しないでください。
          </p>
          <label className="consent">
            <input type="checkbox" name="consent" required />
            手動登録するデータの利用許可・集計定義を確認しました
          </label>
          <button className="primary-button" disabled={busy || !token}>
            {search.mode === "demo" ? "デモ" : "実データ"}用DBに手動登録
          </button>
        </form>
      </details>
      <details>
        <summary>店舗・機種の別名を登録</summary>
        <p>
          同一店舗・同一機種であることを確認してから登録してください。店舗の支店名や機種の世代は省略して統合しません。
        </p>
        <form onSubmit={mapping} className="import-form">
          <div className="source-form-grid">
            <ProviderSelect id="mapping-provider" />
            <div className="field">
              <label htmlFor="mapping-entity">対象</label>
              <select
                id="mapping-entity"
                name="entity"
                value={entity}
                onChange={(e) => setEntity(e.target.value)}
              >
                <option value="hall">店舗</option>
                <option value="machine">機種</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="mapping-alias">提供元での表記</label>
              <input id="mapping-alias" name="alias" required maxLength={160} />
            </div>
            <div className="field">
              <label htmlFor="mapping-canonical">対応する登録データ</label>
              <select
                id="mapping-canonical"
                name="canonical_id"
                key={entity}
                required
                defaultValue=""
              >
                <option value="" disabled>
                  選択してください
                </option>
                {(entity === "hall" ? catalog.halls : catalog.machines).map(
                  (v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} / {v.id}
                    </option>
                  ),
                )}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="mapping-evidence">同一と確認した根拠</label>
            <input
              id="mapping-evidence"
              name="evidence"
              required
              maxLength={1000}
            />
          </div>
          <button className="secondary-button" disabled={busy || !token}>
            別名を登録
          </button>
        </form>
      </details>
      <button
        className="secondary-button"
        disabled={busy || !token}
        onClick={() => void perform(refresh)}
      >
        出典レコード・名寄せを読み込む
      </button>
      {review && (
        <>
          <h3>出典ごとの実績（最新100件）</h3>
          {!review.observations.length && (
            <p className="muted">
              出典ごとの取込レコードはまだありません。従来のデモ実績は引き続き利用できます。
            </p>
          )}
          {review.observations.map((o) => {
            const data = JSON.parse(o.payload_json) as {
              total_diff: number;
              units: number;
              games: number | null;
              positive_units: number | null;
            };
            return (
              <details className="source-observation" key={o.id}>
                <summary>
                  {o.date} · {o.hall_name} · {o.machine_name} — {o.source_name}
                  （{o.selected ? "採用中" : "未採用"}）
                </summary>
                <p>
                  総差枚 {data.total_diff.toLocaleString()}枚 / 対象{" "}
                  {data.units}台 / プラス {data.positive_units ?? "未取得"}台 /
                  平均 {data.games ?? "未取得"}G
                </p>
                {!o.selected && (
                  <p>
                    現在採用中の総差枚：{o.selected_total_diff.toLocaleString()}
                    枚。同じ値でも出典は個別に保持します。
                  </p>
                )}
                <p>
                  <a href={o.source_url} target="_blank" rel="noreferrer">
                    {o.source_name} ↗
                  </a>{" "}
                  · {o.method}
                </p>
                <p>定義：{o.definition}</p>
                <p>許可根拠：{o.permission}</p>
                <p>
                  元の表記：{o.raw_hall_name} / {o.raw_machine_name}
                </p>
                <p>
                  取得：{dateTime(o.retrieved_at)} / 登録：
                  {dateTime(o.imported_at)}
                </p>
                <p>
                  公開：{dateTime(o.published_at)} / 提供元更新：
                  {dateTime(o.source_updated_at)}
                </p>
                {!o.selected && (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await request("/api/source-management", {
                          action: "select",
                          id: o.id,
                        });
                        setMessage(
                          "採用する出典を変更し、訂正履歴に保存しました。",
                        );
                        await refresh();
                      })
                    }
                  >
                    この出典を採用
                  </button>
                )}
              </details>
            );
          })}
          <h3>取得元ごとの名寄せ（最新100件）</h3>
          <p className="muted">別名は照合に使う正規化表記で表示しています。</p>
          {review.mappings.length ? (
            <ul>
              {review.mappings.map((m) => (
                <li key={`${m.provider_id}/${m.entity}/${m.alias}`}>
                  {m.provider_id} · {m.alias} → {m.canonical_id}（{m.evidence}）
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">追加の名寄せはありません。</p>
          )}
        </>
      )}
      <details>
        <summary>連携候補8サイトと調査状況</summary>
        <p>
          2026年10月10日：環境の通信制限により公式ページを閲覧できていません。分類は調査依頼によるものです。更新頻度・保存期間・対象地域・取得手段・利用規約・API提供はすべて未確認で、自動連携は無効です。
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>候補</th>
                <th>調査対象</th>
                <th>連携状態</th>
              </tr>
            </thead>
            <tbody>
              {sourceCandidates.map((s) => (
                <tr key={s.id}>
                  <td>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.name} ↗
                    </a>
                  </td>
                  <td>{s.category}</td>
                  <td>利用条件の確認待ち</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          正式な契約・公開データの利用許諾を確認した後、共通CSVへ変換して取り込みます。CSVや手動入力でも転載・利用許可の確認が必要です。
        </p>
      </details>
    </section>
  );
}
