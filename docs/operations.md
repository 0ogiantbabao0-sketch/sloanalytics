# 起動・更新・運用・デプロイ

## 開発と本番

Node.js 24、npm lockfileに固定した依存関係、書込み可能な永続ディスクが必要です。開発は `npm ci && npm run db:setup && npm run dev`。本番は `npm run build && npm start`。コマンドはプロジェクトルートで実行します。

`GET /api/health` がHTTP 200・`status: ok` を返すことを確認します。さらに検索画面でデモ実績のランキングと根拠が出ることを確認してください。ヘルスチェックだけでは機能検証の代わりになりません。

`.env.local` はNext.jsとCLI両方で読みます。環境変数で渡した値が優先します。

- `DATA_DIR`：DB保存先。標準 `./data`。
- `ADMIN_IMPORT_TOKEN`：管理画面のCSV登録用。十分長いランダム値を設定。未設定時は登録を拒否。
- `PERMITTED_CSV_URL` / `PERMITTED_CSV_HOST`：正式な許可を確認したHTTPS CSV取得先。未設定時は取得しない。

既存設定ファイルを上書きしないでください。DB・ログ・トークンをGitへ追加しないでください。

## 許諾済みソースの定期更新

```sh
npm run data:update
```

アダプタは設定した完全一致ホストだけを受け付けます。TLS検証を維持し、リダイレクトを拒否、30秒タイムアウト、2MB制限。CSVは管理画面と同じ検証・トランザクションで登録します。ネットワーク失敗も `import_jobs` に記録し、終了コードを非0にします。失敗後は原因を解消し、同じコマンドで手動再試行できます。

利用条件が1日1回を認める場合のcron例（サーバーのタイムゾーンを確認）：

```cron
17 3 * * * cd /srv/sloanalytics && /usr/local/bin/npm run data:update >> /var/log/sloanalytics-update.log 2>&1
```

このcronは自動登録していません。契約上の許可頻度に合わせて設定し、実行ユーザーにDATA_DIRへの権限を与えます。ログには認証情報を出さないでください。専用通知サービス・自動バックオフ・監視ダッシュボードは未実装です。

## バックアップ・復旧

SQLiteはWALモードです。稼働中に `.sqlite` だけをコピーしないでください。SQLite対応バックアップを利用するか、Webサーバーと更新処理を停止し、チェックポイント実行後にDBを保存します。

```sh
# 全書込みプロセスの停止後。sqlite3 CLIを使える環境で実行。
sqlite3 data/real.sqlite 'PRAGMA wal_checkpoint(TRUNCATE);'
sqlite3 data/real.sqlite ".backup '/secure-backups/real.sqlite'"
```

復旧は停止中にバックアップから復元し、所有権、`PRAGMA integrity_check`、ヘルスチェック、代表検索を確認します。スキーマを変更するときはバックアップして、明示的なバージョン付きマイグレーションを追加してください。現在のスキーマ初期化は `IF NOT EXISTS` であり既存テーブルを自動変更しません。

## Docker / 永続ディスク付きホスティング

付属DockerfileはNode 24でビルドします。Dockerビルド・外部公開はこの環境では未検証です。

```sh
docker build -t slot-analytics .
docker volume create slot-data
docker run --rm -p 3000:3000 --mount source=slot-data,target=/app/data \
  --env-file /secure-config/slot.env slot-analytics
```

単一Nodeプロセス＋永続ディスクを持つVPS、コンテナホスト等に適合します。公開する場合はTLS、アクセス制御、インポートAPIのリバースプロキシ側レート制限、バックアップ、更新監視を設定してください。全読取りAPIはログイン不要です。契約上非公開の実績は公開デプロイしないでください。

## Cloudflareとの違い

現在はNode.jsの `node:sqlite` とローカル永続ファイルを使います。Cloudflare Pagesの静的公開だけではサーバーAPI・DB書込みは動作しません。Workersへ移す場合はD1用SQLアダプタ、Workers対応Nextランタイム、Cron Trigger、SecretsとD1マイグレーションが必要です。

本番で複数レプリカや大量履歴を扱う場合はPostgreSQL、非同期ジョブキュー、ページング／集計キャッシュへ移行します。SQLiteファイルを複数ホストで共有しないでください。

## クラウド環境のネットワーク

通常の依存取得はnpmレジストリ。背景地図には `tile.openstreetmap.org`、WebKit導入には `cdn.playwright.dev` と `playwright.download.prss.microsoft.com` が必要です。新しいPlaywright Chromiumの配布によっては `storage.googleapis.com` も使用されます。通信が拒否された場合は必要な宛先を設定し、影響する操作を再検証します。設定保存や公開自体は新しい環境での動作検証ではありません。
