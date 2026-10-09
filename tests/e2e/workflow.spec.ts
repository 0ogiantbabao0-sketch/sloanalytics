import { test, expect } from "@playwright/test";
test("A/B: machine selection, auto ranking, save and responsive layout", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "次の一台を、データから。" }),
  ).toBeVisible();
  await page.locator("#target").fill("2026-10-10");
  await page.getByRole("button", { name: "機種指定 好きな機種で比較" }).click();
  await page.getByRole("textbox", { name: "機種名を検索" }).fill("カバネリ");
  await page
    .getByRole("checkbox", { name: "L カバネリ 海門決戦", exact: true })
    .check();
  await page.getByRole("button", { name: "この条件で分析する" }).click();
  await expect(page.locator(".ranking-card").first()).toBeVisible();
  await expect(page.locator(".ranking-card .machine-link").first()).toHaveText(
    "L カバネリ 海門決戦",
  );
  await expect(
    page
      .locator(".ranking-card .machine-link")
      .filter({ hasText: "マイジャグラー" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "おまかせ すべてのホール × 機種" })
    .click();
  await page.getByRole("button", { name: "この条件で分析する" }).click();
  await expect(
    page
      .locator(".ranking-card .machine-link")
      .filter({ hasText: "マイジャグラーV" })
      .first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "条件を保存" }).click();
  await expect(page.locator(".save-message")).toContainText("保存しました");
  const horizontal = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(horizontal).toBe(false);
  await page.screenshot({
    path: `test-results/dashboard-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "お気に入り・保存", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "保存した検索条件" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "長岡京駅・30km・2026-10-10 →",
      exact: true,
    }),
  ).toBeVisible();
});
test("C/D/E: monthly date, holiday end, comparison and detail", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#target").fill("2026-10-10");
  await page
    .getByRole("button", { name: "ホール指定 店舗内のおすすめ" })
    .click();
  await page
    .getByRole("combobox", { name: "ホールを選択" })
    .selectOption("demo-nagaoka");
  await page.locator(".advanced > summary").click();
  await page.getByRole("combobox", { name: "毎月の特定日" }).selectOption("11");
  await page.getByRole("button", { name: "この条件で分析する" }).click();
  await expect(page.locator(".ranking-card").first()).toBeVisible();
  await page.locator(".ranking-card").first().locator("summary").click();
  await expect(page.locator(".date-list").first()).toContainText("2026-09-11");
  await page.getByRole("combobox", { name: "毎月の特定日" }).selectOption("");
  await page.getByRole("combobox", { name: "連休の長さ" }).selectOption("3");
  await page.getByRole("combobox", { name: "連休の位置" }).selectOption("last");
  await page.getByRole("button", { name: "機種指定 好きな機種で比較" }).click();
  await page
    .getByRole("checkbox", { name: "マイジャグラーV", exact: true })
    .check();
  await page.getByRole("button", { name: "この条件で分析する" }).click();
  await expect(page.locator(".ranking-card").first()).toBeVisible();
  const checks = page.getByRole("checkbox", { name: "比較に追加" });
  await checks.nth(0).check();
  await checks.nth(1).check();
  await page.getByRole("link", { name: "同じ条件で比較する" }).click();
  await page
    .getByRole("combobox", { name: "比較する機種" })
    .selectOption("juggler");
  await expect(page.locator(".comparison-table")).toBeVisible();
  await expect(page.locator(".comparison-table")).not.toContainText(
    "データ不足",
  );
  await page.locator(".comparison-table a").first().click();
  await expect(
    page.getByRole("heading", { name: "基本情報・アクセス" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "表", exact: true }).click();
  await expect(
    page.getByRole("columnheader", { name: "収録機種の加重平均差枚" }),
  ).toBeVisible();
});
test("real data is empty and imports require authorization", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "データモード" })
    .selectOption("real");
  await expect(
    page.getByRole("heading", { name: "該当する実績データがありません" }),
  ).toBeVisible();
  await expect(page.locator(".ranking-card")).toHaveCount(0);
  const result = await request.post("/api/import?mode=real", {
    data: "invalid",
    headers: { authorization: "Bearer wrong" },
  });
  expect([401, 503]).toContain(result.status());
  await page.getByRole("link", { name: "データ管理", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "CSVインポート" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
  ).toBe(false);
});
test("authorized CSV import, source display and safe repeated update", async ({
  page,
  request,
}) => {
  await page.goto("/admin");
  await page
    .getByLabel("管理トークン", { exact: true })
    .fill(process.env.SLOT_E2E_TOKEN!);
  await page
    .getByLabel("CSVファイル")
    .setInputFiles("public/samples/demo-results.csv");
  await page
    .getByRole("checkbox", {
      name: "データの利用・転載許可と出典を確認しました",
    })
    .check();
  await page.getByRole("button", { name: "デモ用DBに取り込む" }).click();
  await expect(page.getByRole("status")).toContainText("9行を処理しました");
  await expect(
    page.getByRole("link", { name: "サンプルCSV ↗", exact: true }),
  ).toBeVisible();
  const catalog = await (await request.get("/api/catalog?mode=real")).json();
  expect(catalog.halls).toHaveLength(0);
});
