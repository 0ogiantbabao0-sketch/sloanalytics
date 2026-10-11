"use client";
import { useState } from "react";
export default function Login() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login-panel panel">
      <div className="eyebrow">SLOT ANALYTICS</div>
      <h1>本人用ログイン</h1>
      <p>あなたの実績データを確認するにはログインしてください。</p>
      <form
        className="import-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const data = new FormData(e.currentTarget);
          try {
            const res = await fetch("/api/session", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ password: data.get("password") }),
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error);
            location.assign("/");
          } catch (e) {
            setError(e instanceof Error ? e.message : "通信に失敗しました");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          パスワード
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </label>
        <button className="primary-button" disabled={busy}>
          {busy ? "確認中…" : "ログイン"}
        </button>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
