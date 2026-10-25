import { expect, test } from "@playwright/test";

test("replays the cinematic intro on every landing reload only", async ({ page }) => {
  const intro = page.getByRole("status", {
    name: "TrustVault secure channel initialization",
  });

  await page.goto("/");
  await expect(intro).toBeVisible();
  await expect(intro).toBeHidden({ timeout: 7_000 });

  await page.reload();
  await expect(intro).toBeVisible();

  await page.goto("/login");
  await expect(intro).toHaveCount(0);
});
