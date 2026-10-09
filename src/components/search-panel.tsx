"use client";
import { useEffect, useState } from "react";
import {
  MapPin,
  SlidersHorizontal,
  Search as SearchIcon,
  ChevronDown,
  BookmarkPlus,
} from "lucide-react";
import { useApp, places } from "./provider";
import { addDays, normalizeMachine, todayJST } from "@/lib/calendar";
import type { Search } from "@/lib/types";
export function SearchPanel() {
  const { search, setSearch, catalog, store, setStore } = useApp();
  const [draft, setDraft] = useState<Search>(search);
  const [query, setQuery] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => setDraft(search), [search]);
  const change = (v: Partial<Search>) => setDraft({ ...draft, ...v });
  const cond = (v: Partial<Search["conditions"]>) =>
    change({ conditions: { ...draft.conditions, ...v } });
  const candidates = [
    ...places,
    ...store.places,
    ...catalog.halls.map((h) => ({
      name: h.name,
      lat: h.lat,
      lng: h.lng,
      address: h.address,
    })),
  ].filter((p) =>
    `${p.name} ${"address" in p ? p.address : ""}`.includes(locationQuery),
  );
  const machineList = catalog.machines.filter(
    (m) =>
      normalizeMachine(m.name).includes(normalizeMachine(query)) ||
      catalog.aliases.some(
        (a) =>
          a.machine_id === m.id && a.alias.includes(normalizeMachine(query)),
      ),
  );
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(draft);
    setStore({ ...store, history: [draft, ...store.history].slice(0, 10) });
    setMessage("検索条件を適用しました");
  };
  return (
    <form className="search-panel panel" onSubmit={submit}>
      <div className="panel-title">
        <span>
          <SlidersHorizontal size={18} />
          検索条件
        </span>
        <span className="subtle">条件を揃えて、ホールを比較</span>
      </div>
      <details className="main-search" open>
        <summary>
          エリア・日付・機種を設定 <ChevronDown size={16} />
        </summary>
        <div className="search-grid">
          <div className="field location-field">
            <label htmlFor="center">検索の中心地</label>
            <div className="input-icon">
              <MapPin size={17} />
              <input
                id="center"
                value={locationQuery}
                onChange={(e) => setLocationQuery(e.target.value)}
                placeholder={draft.center.name}
                autoComplete="off"
              />
            </div>
            {locationQuery && (
              <div className="suggestions">
                {candidates.length ? (
                  candidates.slice(0, 8).map((p, i) => (
                    <button
                      type="button"
                      key={i}
                      onClick={() => {
                        change({
                          center: { name: p.name, lat: p.lat, lng: p.lng },
                        });
                        setLocationQuery("");
                      }}
                    >
                      {p.name}
                    </button>
                  ))
                ) : (
                  <span>登録地点に該当なし。地図から指定できます。</span>
                )}
              </div>
            )}
            <div className="place-chips">
              {places.map((p) => (
                <button
                  type="button"
                  className={draft.center.name === p.name ? "chosen" : ""}
                  key={p.name}
                  onClick={() => change({ center: p })}
                >
                  {p.name.replace("駅", "")}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="radius">
              検索半径 <span>直線距離</span>
            </label>
            <div className="range-row">
              <input
                id="radius"
                type="range"
                min="5"
                max="100"
                step="5"
                value={draft.radius}
                onChange={(e) => change({ radius: +e.target.value })}
              />
              <input
                aria-label="半径の数値"
                className="number-input"
                type="number"
                min="5"
                max="100"
                value={draft.radius}
                onChange={(e) => change({ radius: +e.target.value })}
              />
              <span>km</span>
            </div>
            <select
              aria-label="移動手段"
              value={draft.transport}
              onChange={(e) => change({ transport: e.target.value })}
            >
              <option value="both">電車・車</option>
              <option value="train">電車</option>
              <option value="car">車</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="target">対象日</label>
            <input
              id="target"
              type="date"
              min="1970-01-01"
              max="2050-12-31"
              value={draft.targetDate}
              onChange={(e) => change({ targetDate: e.target.value })}
            />
            <div className="place-chips">
              <button
                type="button"
                onClick={() => change({ targetDate: todayJST() })}
              >
                今日
              </button>
              <button
                type="button"
                onClick={() => change({ targetDate: addDays(todayJST(), 1) })}
              >
                明日
              </button>
              <button
                type="button"
                onClick={() =>
                  change({ targetEnd: draft.targetEnd ? "" : draft.targetDate })
                }
              >
                期間指定
              </button>
            </div>
            {draft.targetEnd && (
              <input
                aria-label="対象期間の終了日"
                type="date"
                value={draft.targetEnd}
                min={draft.targetDate}
                onChange={(e) => change({ targetEnd: e.target.value })}
              />
            )}
          </div>
          <div className="field">
            <label htmlFor="period">分析対象期間</label>
            <select
              id="period"
              value={draft.from ? "custom" : String(draft.days)}
              onChange={(e) =>
                e.target.value === "custom"
                  ? change({
                      from: addDays(draft.targetDate, -180),
                      to: addDays(draft.targetDate, -1),
                    })
                  : change({ days: +e.target.value, from: "", to: "" })
              }
            >
              {[30, 90, 180, 365].map((d) => (
                <option key={d} value={d}>
                  過去{d}日
                </option>
              ))}
              <option value="custom">任意期間</option>
            </select>
            <small>対象日の前日までを集計</small>
            {draft.from && (
              <div className="date-pair">
                <input
                  aria-label="分析開始"
                  type="date"
                  value={draft.from}
                  onChange={(e) => change({ from: e.target.value })}
                />
                <input
                  aria-label="分析終了"
                  type="date"
                  value={draft.to}
                  onChange={(e) => change({ to: e.target.value })}
                />
              </div>
            )}
          </div>
        </div>
        <div
          className="ranking-modes"
          role="group"
          aria-label="ランキングモード"
        >
          {[
            ["auto", "おまかせ", "すべてのホール × 機種"],
            ["machine", "機種指定", "好きな機種で比較"],
            ["hall", "ホール指定", "店舗内のおすすめ"],
          ].map(([value, label, hint]) => (
            <button
              key={value}
              type="button"
              className={draft.rankingMode === value ? "selected" : ""}
              onClick={() =>
                change({ rankingMode: value as Search["rankingMode"] })
              }
            >
              <span className="radio-dot" />
              <span>
                <strong>{label}</strong>
                <small>{hint}</small>
              </span>
            </button>
          ))}
        </div>
        {draft.rankingMode === "machine" && (
          <div className="machine-picker">
            <input
              aria-label="機種名を検索"
              placeholder="機種名・略称で検索（例：カバネリ）"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="chips">
              {machineList.map((m) => (
                <label
                  key={m.id}
                  className={
                    draft.machineIds.includes(m.id) ? "chip chosen" : "chip"
                  }
                >
                  <input
                    type="checkbox"
                    checked={draft.machineIds.includes(m.id)}
                    onChange={() =>
                      change({
                        machineIds: draft.machineIds.includes(m.id)
                          ? draft.machineIds.filter((id) => id !== m.id)
                          : [...draft.machineIds, m.id],
                      })
                    }
                  />
                  {m.name}
                </label>
              ))}
            </div>
          </div>
        )}
        {draft.rankingMode === "hall" && (
          <select
            aria-label="ホールを選択"
            value={draft.hallId}
            onChange={(e) => change({ hallId: e.target.value })}
          >
            <option value="">ホールを選択してください</option>
            {catalog.halls.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        )}
      </details>
      <details className="advanced">
        <summary>
          <span>
            <SlidersHorizontal size={15} /> 曜日・特定日・連休・イベント
          </span>
          <ChevronDown size={16} />
        </summary>
        <div className="advanced-grid">
          <div className="field">
            <label>条件の組み合わせ</label>
            <select
              aria-label="条件の組み合わせ"
              value={draft.conditions.join}
              onChange={(e) => cond({ join: e.target.value as "AND" | "OR" })}
            >
              <option value="AND">AND：すべて一致</option>
              <option value="OR">OR：いずれか一致</option>
            </select>
          </div>
          <div className="field">
            <label>○のつく日（末尾）</label>
            <div className="digit-buttons">
              {Array.from({ length: 10 }, (_, n) => (
                <button
                  type="button"
                  key={n}
                  className={
                    draft.conditions.digits.includes(n) ? "chosen" : ""
                  }
                  onClick={() =>
                    cond({
                      digits: draft.conditions.digits.includes(n)
                        ? draft.conditions.digits.filter((d) => d !== n)
                        : [...draft.conditions.digits, n],
                    })
                  }
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>毎月の特定日</label>
            <select
              aria-label="毎月の特定日"
              value={draft.conditions.monthDays[0] || ""}
              onChange={(e) =>
                cond({ monthDays: e.target.value ? [+e.target.value] : [] })
              }
            >
              <option value="">指定なし</option>
              {Array.from({ length: 31 }, (_, i) => (
                <option key={i} value={i + 1}>
                  毎月{i + 1}日
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>曜日</label>
            <div className="digit-buttons">
              {["日", "月", "火", "水", "木", "金", "土"].map((d, n) => (
                <button
                  type="button"
                  key={d}
                  className={
                    draft.conditions.weekdays.includes(n) ? "chosen" : ""
                  }
                  onClick={() =>
                    cond({
                      weekdays: draft.conditions.weekdays.includes(n)
                        ? draft.conditions.weekdays.filter((d) => d !== n)
                        : [...draft.conditions.weekdays, n],
                    })
                  }
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>曜日グループ</label>
            <select
              aria-label="曜日グループ"
              value={draft.conditions.dayGroup}
              onChange={(e) => cond({ dayGroup: e.target.value })}
            >
              <option value="">指定なし</option>
              <option value="weekdays">平日（祝日除く）</option>
              <option value="weekend">土日</option>
              <option value="off">土日祝</option>
            </select>
          </div>
          <div className="field">
            <label>連休の長さ</label>
            <select
              aria-label="連休の長さ"
              value={draft.conditions.minStreak}
              onChange={(e) => cond({ minStreak: +e.target.value })}
            >
              <option value="0">指定なし</option>
              {[3, 4, 5].map((n) => (
                <option value={n} key={n}>
                  {n}連休以上
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>連休の位置</label>
            <select
              aria-label="連休の位置"
              value={draft.conditions.streakPosition}
              onChange={(e) => cond({ streakPosition: e.target.value })}
            >
              <option value="">指定なし</option>
              <option value="first">初日</option>
              <option value="middle">中日</option>
              <option value="last">最終日</option>
            </select>
          </div>
          <div className="field">
            <label>連休の何日目</label>
            <input
              aria-label="連休の何日目"
              type="number"
              min="0"
              max="15"
              value={draft.conditions.streakIndex}
              onChange={(e) => cond({ streakIndex: +e.target.value })}
            />
            <small>0は指定なし</small>
          </div>
          <div className="field">
            <label>イベント種類</label>
            <select
              aria-label="イベント種類"
              value={draft.conditions.eventType}
              onChange={(e) => cond({ eventType: e.target.value })}
            >
              <option value="">指定なし</option>
              <option value="any">掲載あり</option>
              <option value="visit">来店予定・履歴</option>
              <option value="coverage">取材予定・履歴</option>
              <option value="other">その他</option>
            </select>
          </div>
          <div className="field">
            <label>イベント名・出演者</label>
            <input
              aria-label="イベント名・出演者"
              value={draft.conditions.eventText}
              onChange={(e) => cond({ eventText: e.target.value })}
            />
          </div>
          <div className="field check-stack">
            <label>
              <input
                type="checkbox"
                checked={draft.conditions.doubles}
                onChange={(e) => cond({ doubles: e.target.checked })}
              />
              ゾロ目（11・22日／月日一致）
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.conditions.special}
                onChange={(e) => cond({ special: e.target.checked })}
              />
              ホールの旧特定日
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.comparePrevious}
                onChange={(e) => change({ comparePrevious: e.target.checked })}
              />
              前年同時期と比較
            </label>
          </div>
        </div>
        <p className="muted">
          条件は過去の営業日に適用します。対象日は期間の基準とイベント照会に使用します。連休条件内の長さ・位置・日数は常にANDです。
        </p>
      </details>
      <div className="search-actions">
        <button
          type="button"
          className="text-button"
          onClick={() => {
            const name = `${draft.center.name}・${draft.radius}km・${draft.targetDate}`;
            setStore({
              ...store,
              saved: [...store.saved, { name, search: draft }],
            });
            setMessage("検索条件を保存しました");
          }}
        >
          <BookmarkPlus size={16} />
          条件を保存
        </button>
        <span role="status" className="save-message">
          {message}
        </span>
        <button className="primary-button" type="submit">
          <SearchIcon size={17} />
          この条件で分析する
        </button>
      </div>
    </form>
  );
}
