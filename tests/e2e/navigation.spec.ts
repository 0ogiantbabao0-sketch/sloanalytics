import { test, expect } from "@playwright/test";

test("main navigation switches all five screens and preserves applied search", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "メインナビゲーション" });
  await expect(nav.getByRole("link")).toHaveCount(5);
  await page.locator("#target").fill("2026-10-08");
  await page.getByRole("button", { name: "この条件で分析する" }).click();
  await expect(page.locator(".save-message")).toContainText(
    "検索条件を適用しました",
  );
  for (const [label, path, heading] of [
    ["ホール比較", "/compare", "同じ条件で、ホールを比較。"],
    ["台番分析", "/units", "台番ごとの実績を見る"],
    ["お気に入り・保存", "/saved", "保存した検索条件"],
    ["データ管理", "/admin", "データ収集・管理"],
    ["ホールを探す", "/", "次の一台を、データから。"],
  ]) {
    const link = nav.getByRole("link", { name: label, exact: true });
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${path}$`), { timeout: 15000 });
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(nav.locator("[aria-current]")).toHaveCount(1);
  }
  await expect(page.locator("#target")).toHaveValue("2026-10-08");
  const saved = nav.getByRole("link", {
    name: "お気に入り・保存",
    exact: true,
  });
  await saved.focus();
  await page.keyboard.press("Enter");
  await expect(saved).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(
    nav.getByRole("link", { name: "ホールを探す", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  if (testInfo.project.name === "desktop") {
    await expect(page.locator(".sidebar .brand")).toBeVisible();
    await expect(nav.locator(".nav-label-mobile").first()).toBeHidden();
  }
});

test("mobile tabs remain reachable, avoid overlap and identify detail pages", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "Mobile bottom-tab behavior");
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "メインナビゲーション" });
  const find = nav.getByRole("link", { name: "ホールを探す", exact: true });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const link of await nav.getByRole("link").all()) {
      const box = await link.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  }
  await page.getByRole("checkbox", { name: "比較に追加" }).first().check();
  await expect(
    nav.getByRole("link", { name: "ホール比較", exact: true }),
  ).toHaveAttribute("aria-description", "比較候補1店舗");
  await page.locator(".compare-bar").scrollIntoViewIfNeeded();
  const bar = await page.locator(".compare-bar").boundingBox();
  const tabs = await page.locator(".sidebar").boundingBox();
  expect(bar!.y + bar!.height).toBeLessThanOrEqual(tabs!.y);
  await page.locator(".footer").scrollIntoViewIfNeeded();
  const footer = await page.locator(".footer").boundingBox();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(tabs!.y);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await find.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({
    path: `test-results/mobile-tabs-${testInfo.project.name}.png`,
  });
  await page.locator(".ranking-card .detail-link").first().click();
  await expect(find).toHaveAttribute("aria-current", "location");
  await expect(nav.locator("[aria-current]")).toHaveCount(1);
  await find.click();
  await expect(page).toHaveURL(/\/$/);
});
