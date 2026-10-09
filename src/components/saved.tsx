"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp } from "./provider";
export function Saved() {
  const { store, setStore, setSearch, catalog, toggleFavorite } = useApp();
  const router = useRouter();
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR COLLECTION</div>
          <h1>お気に入りと保存した条件</h1>
          <p>このブラウザに保存されます。ログインは不要です。</p>
        </div>
      </div>
      <div className="detail-grid">
        <section className="panel info-panel">
          <h2>お気に入り</h2>
          {store.favorites.length ? (
            store.favorites.map((key) => {
              const [type, id] = key.split(":");
              const item =
                type === "hall"
                  ? catalog.halls.find((h) => h.id === id)
                  : catalog.machines.find((m) => m.id === id);
              return (
                <div className="saved-row" key={key}>
                  {item ? (
                    <Link
                      href={`/${type === "hall" ? "halls" : "machines"}/${id}`}
                    >
                      {item.name}
                    </Link>
                  ) : (
                    <span>別データモードの保存項目</span>
                  )}
                  <button
                    className="text-button"
                    onClick={() => toggleFavorite(key)}
                  >
                    解除
                  </button>
                </div>
              );
            })
          ) : (
            <p className="muted">ランキング・詳細画面から保存できます。</p>
          )}
        </section>
        <section className="panel info-panel">
          <h2>保存した検索条件</h2>
          {store.saved.map((s, i) => (
            <div className="saved-row" key={i}>
              <button
                className="text-button"
                onClick={() => {
                  setSearch(s.search);
                  router.push("/");
                }}
              >
                {s.name} →
              </button>
              <button
                className="text-button"
                aria-label={`${s.name}を削除`}
                onClick={() =>
                  setStore({
                    ...store,
                    saved: store.saved.filter((_, j) => j !== i),
                  })
                }
              >
                削除
              </button>
            </div>
          ))}
          {!store.saved.length && (
            <p className="muted">検索画面の「条件を保存」から追加できます。</p>
          )}
        </section>
        <section className="panel info-panel">
          <h2>検索履歴</h2>
          {store.history.map((s, i) => (
            <div className="saved-row" key={i}>
              <button
                className="text-button"
                onClick={() => {
                  setSearch(s);
                  router.push("/");
                }}
              >
                {s.center.name} · {s.targetDate} · {s.radius}km →
              </button>
            </div>
          ))}
          {!store.history.length && (
            <p className="muted">検索を実行すると履歴が残ります。</p>
          )}
        </section>
        <section className="panel info-panel">
          <h2>保存した中心地</h2>
          {store.places.map((p, i) => (
            <div className="saved-row" key={i}>
              <span>{p.name}</span>
              <button
                className="text-button"
                onClick={() =>
                  setStore({
                    ...store,
                    places: store.places.filter((_, j) => j !== i),
                  })
                }
              >
                削除
              </button>
            </div>
          ))}
          {!store.places.length && (
            <p className="muted">
              地図の下の「この中心地を保存」で追加できます。
            </p>
          )}
        </section>
      </div>
    </>
  );
}
