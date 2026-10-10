import { readFileSync } from "node:fs";
import { getDb } from "../src/lib/db";
import {
  adapterConfigsSchema,
  PermittedCsvAdapter,
  runAdapters,
} from "../src/lib/adapters";
async function main() {
  const configPath = process.env.PERMITTED_SOURCES_FILE;
  if (!configPath)
    throw new Error(
      "利用契約を確認し、PERMITTED_SOURCES_FILE に許諾済み取得元の設定JSONのパスを指定してください。URLだけでは自動取得しません",
    );
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    throw new Error(
      "取得元設定ファイルを読めません。パスとJSON形式を確認してください",
    );
  }
  const parsed = adapterConfigsSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      "取得元設定が不正です。docs/source-integration.md の必須項目を確認してください",
    );
  const results = await runAdapters(
    getDb("real"),
    parsed.data.map((config) => new PermittedCsvAdapter(config)),
  );
  console.log(JSON.stringify(results, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
