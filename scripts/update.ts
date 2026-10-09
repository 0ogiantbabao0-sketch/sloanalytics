import { getDb } from "../src/lib/db";
import { PermittedCsvAdapter, runAdapter } from "../src/lib/adapters";
async function main() {
  const url = process.env.PERMITTED_CSV_URL,
    host = process.env.PERMITTED_CSV_HOST;
  if (!url || !host)
    throw new Error(
      "利用許可を確認後、PERMITTED_CSV_URL と PERMITTED_CSV_HOST を設定してください",
    );
  console.log(
    await runAdapter(getDb("real"), new PermittedCsvAdapter(url, host)),
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
