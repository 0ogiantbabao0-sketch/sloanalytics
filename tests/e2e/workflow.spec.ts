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

test("manual provenance import, conflicting sources and explicit adoption", async ({
  page,
  request,
}, testInfo) => {
  await page.goto("/admin");
  await page
    .getByLabel("出典管理トークン", { exact: true })
    .fill(process.env.SLOT_E2E_TOKEN!);
  await page.getByText("日別機種実績を手動登録", { exact: true }).click();
  const id = `manual-${testInfo.project.name}`;
  const inputs: Record<string, string> = {
    hall_id: id,
    hall_name: "手動テスト店舗",
    address: "京都府・合成テスト",
    lat: "34.924",
    lng: "135.701",
    machine_name: "L カバネリ 海門決戦",
    date: "2026-10-01",
    units: "10",
    total_diff: "1200",
    positive_units: "6",
    games: "5000",
    source_name: "手動テスト出典A",
    source_url: "https://example.com/manual-a",
    permission: "合成データ・テスト許可",
    retrieved_at: "2026-10-02T10:00:00+09:00",
    published_at: "2026-10-02T09:00:00+09:00",
  };
  for (const [key, value] of Object.entries(inputs))
    await page.locator(`#manual-${key}`).fill(value);
  await page
    .getByLabel("手動登録するデータの利用許可・集計定義を確認しました")
    .check();
  await page
    .getByRole("button", { name: "デモ用DBに手動登録", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("手動登録しました");
  await page.locator("#manual-source_name").fill("手動テスト出典B");
  await page.locator("#manual-source_url").fill("https://example.com/manual-b");
  await page.locator("#manual-total_diff").fill("2400");
  await page
    .getByRole("button", { name: "デモ用DBに手動登録", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("別出典として保存1件");
  const other = page
    .locator(".source-observation")
    .filter({
      has: page.locator("summary", { hasText: "手動テスト出典B（未採用）" }),
    })
    .first();
  await other.locator("summary").click();
  await expect(other).toContainText("2,400枚");
  await expect(other).toContainText("2026/10/2");
  await other.getByRole("button", { name: "この出典を採用" }).click();
  await expect(page.getByRole("status")).toContainText("採用する出典を変更");
  await expect(
    page
      .locator(".source-observation summary")
      .filter({ hasText: "手動テスト出典B（採用中）" })
      .first(),
  ).toBeVisible();
  const result = await (
    await request.get("/api/source-management?mode=demo", {
      headers: { authorization: `Bearer ${process.env.SLOT_E2E_TOKEN}` },
    })
  ).json();
  const selected = result.observations.filter(
    (o: { hall_id: string; selected: number }) =>
      o.hall_id === id && o.selected,
  );
  expect(selected).toHaveLength(1);
  expect(JSON.parse(selected[0].payload_json).total_diff).toBe(2400);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
  ).toBe(false);
  await page.getByText("日別機種実績を手動登録", { exact: true }).click();
  await page
    .locator(".source-workspace")
    .screenshot({ path: `test-results/sources-${testInfo.project.name}.png` });
});

test("source mapping UI and protected management endpoints", async ({
  page,
  request,
}, testInfo) => {
  const unauthorized = await request.get("/api/source-management?mode=demo");
  expect(unauthorized.status()).toBe(401);
  const crossOrigin = await request.post("/api/source-management?mode=demo", {
    headers: {
      authorization: `Bearer ${process.env.SLOT_E2E_TOKEN}`,
      origin: "https://untrusted.example",
    },
    data: { action: "select", id: 1 },
  });
  expect(crossOrigin.status()).toBe(403);
  await page.goto("/admin");
  await page
    .getByLabel("出典管理トークン", { exact: true })
    .fill(process.env.SLOT_E2E_TOKEN!);
  await page.getByText("店舗・機種の別名を登録", { exact: true }).click();
  await page.locator("#mapping-provider").selectOption("min-repo");
  await page.locator("#mapping-entity").selectOption("machine");
  await page
    .locator("#mapping-alias")
    .fill(`検証略称${testInfo.project.name.replaceAll("-", "")}`);
  await page.locator("#mapping-canonical").selectOption("kabaneri");
  await page.locator("#mapping-evidence").fill("合成テスト・型式一致確認");
  await page.getByRole("button", { name: "別名を登録", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("別名を登録しました");
  await expect(
    page.locator(".source-workspace li").filter({
      hasText: `検証略称${testInfo.project.name.replaceAll("-", "")}`,
    }),
  ).toContainText("kabaneri");
  await page.getByText("連携候補8サイトと調査状況", { exact: true }).click();
  await expect(
    page.getByRole("link", { name: "P-WORLD ↗", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".source-workspace")).toContainText("すべて未確認");
});
