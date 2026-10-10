"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  LayoutDashboard,
  GitCompareArrows,
  Bookmark,
  Database,
  Grid2X2,
  ArrowUpRight,
  ShieldCheck,
} from "lucide-react";
import { useApp } from "./provider";
const navigation = [
  {
    href: "/",
    label: "ホールを探す",
    mobileLabel: "探す",
    icon: LayoutDashboard,
  },
  {
    href: "/compare",
    label: "ホール比較",
    mobileLabel: "比較",
    icon: GitCompareArrows,
  },
  { href: "/units", label: "台番分析", mobileLabel: "台番", icon: Grid2X2 },
  {
    href: "/saved",
    label: "お気に入り・保存",
    mobileLabel: "保存",
    icon: Bookmark,
  },
  { href: "/admin", label: "データ管理", mobileLabel: "管理", icon: Database },
];
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { search, setSearch, store } = useApp();
  const activeHref = /^\/(halls|machines)\//.test(path) ? "/" : path;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <BarChart3 size={23} />
          </span>
          <span>
            SLOT<span className="brand-light"> ANALYTICS</span>
            <small>データで、次の選択を。</small>
          </span>
        </Link>
        <div className="nav-caption">WORKSPACE</div>
        <nav aria-label="メインナビゲーション">
          {navigation.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`nav-item ${activeHref === n.href ? "active" : ""}`}
              aria-label={n.label}
              aria-current={
                activeHref === n.href
                  ? path === n.href
                    ? "page"
                    : "location"
                  : undefined
              }
              aria-description={
                n.href === "/compare" && store.comparison.length > 0
                  ? `比較候補${store.comparison.length}店舗`
                  : undefined
              }
              onClick={(e) => {
                if (
                  path !== n.href ||
                  e.metaKey ||
                  e.ctrlKey ||
                  e.shiftKey ||
                  e.altKey ||
                  e.button !== 0 ||
                  !window.matchMedia("(max-width: 760px)").matches
                )
                  return;
                e.preventDefault();
                window.scrollTo({
                  top: 0,
                  behavior: window.matchMedia(
                    "(prefers-reduced-motion: reduce)",
                  ).matches
                    ? "instant"
                    : "smooth",
                });
              }}
            >
              <span className="nav-icon" aria-hidden="true">
                <n.icon size={19} />
              </span>
              <span className="nav-label-desktop">{n.label}</span>
              <span className="nav-label-mobile">{n.mobileLabel}</span>
              {n.href === "/compare" && store.comparison.length > 0 && (
                <b className="nav-count" aria-hidden="true">
                  {store.comparison.length}
                </b>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="insight-icon">
            <ShieldCheck size={20} />
          </div>
          <strong>根拠のある比較を</strong>
          <p>
            過去の実績を、同じ条件で。
            <br />
            データと算出方法を公開しています。
          </p>
          <Link href="/admin">
            データについて <ArrowUpRight size={14} />
          </Link>
        </div>
        <div className="sidebar-footer">
          <span className="status-dot" /> LOCAL WORKSPACE <span>v0.1</span>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="breadcrumb-prefix">ワークスペース</span>
            <span className="breadcrumb-separator">/</span>{" "}
            <strong>
              {navigation.find((n) => n.href === path)?.label || "詳細分析"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="region-label">関西エリア</span>
            <label className={`mode-switch ${search.mode}`}>
              <span className="status-dot" />
              <select
                aria-label="データモード"
                value={search.mode}
                onChange={(e) =>
                  setSearch({
                    ...search,
                    mode: e.target.value as "demo" | "real",
                    hallId: "",
                    machineIds: [],
                    rankingMode: "auto",
                  })
                }
              >
                <option value="demo">デモデータ</option>
                <option value="real">実データ</option>
              </select>
            </label>
            <div className="avatar">SA</div>
          </div>
        </header>
        <div className={`data-banner ${search.mode}`}>
          {search.mode === "demo" ? (
            <>
              <b>DEMO</b>{" "}
              表示中のホール・実績は合成サンプルです。実在店舗の推奨順位ではありません。
            </>
          ) : (
            <>
              <b>LIVE DATA</b>{" "}
              CSVで登録した実データを表示中。未取得の指標は補完しません。
            </>
          )}
        </div>
        <main>{children}</main>
        <footer className="footer">
          SLOT ANALYTICS{" "}
          <span>
            過去実績に基づく相対評価です。設定・勝率・収支を保証するものではありません。
          </span>
        </footer>
      </div>
    </div>
  );
}
