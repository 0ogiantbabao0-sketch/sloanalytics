import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("CSV wizard imports masters and average-only results, shows scores and stays usable on mobile", async ({
  page,
  request,
}) => {
  const token = process.env.SLOT_E2E_TOKEN!;
  const result = await request.post("/api/workspace?mode=demo&action=source", {
    headers: { authorization: `Bearer ${token}` },
    data: {
      id: "ui-csv",
      name: "UIテスト用DEMO",
      url: "https://example.com/demo",
      category: "DEMO",
      method: "csv",
      enabled: true,
      priority: 100,
      storageAllowed: true,
      autoAllowed: false,
      permission: "合成DEMOのテスト",
      checkedAt: "2026-10-01",
      frequency: "手動",
    },
  });
  expect(result.ok()).toBeTruthy();
  await page.goto("/admin");
  const workspace = page.getByRole("region", {
    name: "データ収集・管理",
    exact: true,
  });
  await workspace.getByText("開発環境の管理トークン", { exact: true }).click();
  await workspace.getByLabel("管理トークン（開発用）").fill(token);
  await workspace.getByRole("button", { name: "管理情報を読み込む" }).click();
  await expect(workspace.getByLabel("CSV取得元")).toContainText(
    "UIテスト用DEMO",
  );
  await workspace.getByLabel("CSV取得元").selectOption("ui-csv");
  async function upload(kind: string, content: string) {
    await workspace.getByLabel("CSV種別").selectOption(kind);
    await workspace
      .getByLabel("マッピング用CSV")
      .setInputFiles({
        name: "日本語DEMO.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(content),
      });
    await workspace
      .getByRole("button", { name: "ファイルを解析", exact: true })
      .click();
    await expect(
      workspace.getByRole("heading", { name: "列の対応を確認" }),
    ).toBeVisible();
    await workspace
      .getByRole("checkbox", {
        name: "列の意味、正規化の方針、出典と保存利用条件を確認しました",
      })
      .check();
    await workspace
      .getByRole("button", { name: "プレビュー・検証する" })
      .click();
    await expect(
      workspace.getByRole("heading", { name: "検証結果", exact: true }),
    ).toBeVisible();
    await workspace
      .getByRole("checkbox", {
        name: "補正内容・警告を確認し、「警告あり」の行も登録する",
      })
      .check();
    await workspace.getByRole("button", { name: "確認した行をDB登録" }).click();
    await expect(workspace.getByRole("status")).toContainText(
      "登録完了後の検索",
    );
  }
  const suffix = test.info().project.name,
    hall = `ui-${suffix}`;
  await upload(
    "halls",
    `data_kind,hall_id,hall_name,address,lat,lng,source_url\ndemo,${hall},UI京都DEMO${suffix},京都・架空,34.9858,135.7588,https://example.com/demo\n`,
  );
  await upload(
    "installations",
    `data_kind,hall_id,machine_name,units,valid_from,valid_to,source_url\ndemo,${hall},マイジャグラーV,10,2026-09-01,2026-10-31,https://example.com/demo\n`,
  );
  await upload(
    "results",
    "data_kind,hall_id,machine_name,date,units,avg_diff,positive_units,games,source_url\n" +
      Array.from(
        { length: 14 },
        (_, i) =>
          `demo,${hall},マイジャグラーV,2026-09-${String(i + 1).padStart(2, "0")},10,${100 + i * 10},5,3000,https://example.com/demo\n`,
      ).join(""),
  );
  await expect(workspace.getByRole("status")).toContainText("登録14件");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `test-results/csv-workspace-${suffix}.png`,
    fullPage: false,
  });
  await page.goto("/");
  await page.locator("#target").fill("2026-10-10");
  await page
    .getByRole("button", { name: "ホール指定 店舗内のおすすめ" })
    .click();
  await page.getByLabel("ホールを選択").selectOption(hall);
  await page.getByRole("button", { name: "この条件で分析する" }).click();
  await expect(page.locator(".ranking-card").first()).toBeVisible();
  await expect(page.locator(".score-evidence").first()).toContainText(
    "ホール総合期待度",
  );
  await page.locator(".score-evidence summary").first().click();
  await expect(
    page.getByRole("heading", { name: "信頼度の根拠" }).first(),
  ).toBeVisible();
  await expect(page.locator(".score-evidence").first()).toContainText(
    "2026-09-01",
  );
});
