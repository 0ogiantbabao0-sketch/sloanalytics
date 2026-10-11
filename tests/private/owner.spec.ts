import { test, expect } from "@playwright/test";
test("production requires owner login for pages and data APIs; HTTP-only session and logout", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/catalog?mode=real")).status()).toBe(401);
  expect((await request.get("/api/workspace?mode=real")).status()).toBe(401);
  expect(
    (
      await request.post("/api/search", {
        headers: { origin: "https://unrelated.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("パスワード").fill(process.env.SLOT_PRIVATE_PASSWORD!);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3200/");
  expect(
    await page.evaluate(() => document.cookie.includes("slot_owner")),
  ).toBe(false);
  // Chromium treats localhost as a secure context and accepts Secure session cookies.
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === "slot_owner")?.httpOnly).toBe(true);
  expect(cookies.find((c) => c.name === "slot_owner")?.secure).toBe(true);
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "データ収集・管理", exact: true }),
  ).toBeVisible();
  const response = await page.request.get("/api/workspace?mode=demo");
  expect(response.status()).toBe(200);
  await page.screenshot({
    path: "test-results/private-mobile.png",
    fullPage: false,
  });
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/catalog?mode=real")).status()).toBe(401);
});
