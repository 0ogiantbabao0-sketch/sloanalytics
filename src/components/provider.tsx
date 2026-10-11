"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type {
  Hall,
  Machine,
  Search,
  SearchResponse,
  Source,
} from "@/lib/types";
import { emptyConditions, todayJST } from "@/lib/calendar";
export const places = [
  { name: "長岡京駅", lat: 34.9237, lng: 135.7001 },
  { name: "京都駅", lat: 34.9858, lng: 135.7588 },
  { name: "梅田駅", lat: 34.7055, lng: 135.4983 },
  { name: "高槻駅", lat: 34.8518, lng: 135.6178 },
];
export function defaultSearch(): Search {
  return {
    mode: "demo",
    center: places[0],
    radius: 30,
    transport: "both",
    targetDate: todayJST(),
    targetEnd: "",
    days: 180,
    from: "",
    to: "",
    conditions: { ...emptyConditions },
    rankingMode: "auto",
    machineIds: [],
    hallId: "",
    bestOnly: false,
    sort: "score",
    comparePrevious: false,
  };
}
export type Catalog = {
  halls: Hall[];
  machines: Machine[];
  aliases: { alias: string; machine_id: string }[];
  sources: Source[];
  jobs: {
    id: number;
    started_at: string;
    status: string;
    row_count: number;
    error: string | null;
  }[];
};
type Stored = {
  favorites: string[];
  comparison: string[];
  saved: { name: string; search: Search }[];
  history: Search[];
  places: typeof places;
};
const emptyStore: Stored = {
  favorites: [],
  comparison: [],
  saved: [],
  history: [],
  places: [],
};
type AppContext = {
  search: Search;
  setSearch: (s: Search) => void;
  catalog: Catalog;
  store: Stored;
  setStore: (s: Stored) => void;
  toggleFavorite: (id: string) => void;
  toggleCompare: (id: string) => void;
  reload: () => void;
  loaded: boolean;
  revision: number;
};
const Context = createContext<AppContext | null>(null);
export function Provider({ children }: { children: ReactNode }) {
  const [search, setSearch] = useState<Search>(defaultSearch);
  const [store, setStore] = useState<Stored>(emptyStore);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [catalog, setCatalog] = useState<Catalog>({
    halls: [],
    machines: [],
    aliases: [],
    sources: [],
    jobs: [],
  });
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("slot-analytics-v1") || "null");
      if (s?.store && Array.isArray(s.store.favorites))
        setStore({ ...emptyStore, ...s.store });
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded)
      try {
        localStorage.setItem("slot-analytics-v1", JSON.stringify({ store }));
      } catch {}
  }, [store, loaded]);
  useEffect(() => {
    const c = new AbortController();
    fetch(`/api/catalog?mode=${search.mode}`, { signal: c.signal })
      .then((r) => {
        if (r.status === 401) {
          location.assign("/login");
          throw new Error("ログインしてください");
        }
        if (!r.ok) throw new Error("カタログ取得失敗");
        return r.json();
      })
      .then(setCatalog)
      .catch(() => {});
    return () => c.abort();
  }, [search.mode, revision]);
  const toggleFavorite = (id: string) =>
    setStore({
      ...store,
      favorites: store.favorites.includes(id)
        ? store.favorites.filter((x) => x !== id)
        : [...store.favorites, id],
    });
  const toggleCompare = (id: string) =>
    setStore({
      ...store,
      comparison: store.comparison.includes(id)
        ? store.comparison.filter((x) => x !== id)
        : store.comparison.length < 5
          ? [...store.comparison, id]
          : store.comparison,
    });
  return (
    <Context.Provider
      value={{
        search,
        setSearch,
        catalog,
        store,
        setStore,
        toggleFavorite,
        toggleCompare,
        reload: () => setRevision((n) => n + 1),
        loaded,
        revision,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useApp() {
  return useContext(Context)!;
}
export function useAnalysis(input: Search) {
  const { revision } = useApp();
  const [data, setData] = useState<SearchResponse | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const key = JSON.stringify(input);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: key,
      signal: c.signal,
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        return d;
      })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [key, revision]);
  return { data, error, loading };
}
