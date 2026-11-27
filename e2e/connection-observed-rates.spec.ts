import { expect, test } from "@playwright/test";

test("connection inspector measures fresh traffic and clears it after a gap or reopening", async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await page.getByRole("link", { name: "Connections", exact: true }).first().click();

  const details = page.getByRole("button", { name: "Details for mock-1", exact: true });
  await expect(details).toBeVisible();
  // Let the demo publish a positive delta before opening so it is retained input.
  await page.clock.runFor(2250);
  await details.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Connection details", exact: true });
  const fact = (label: string) => dialog.locator("dt").filter({ hasText: label }).locator("..").locator("dd");
  const upload = fact("Browser-observed upload rate");
  const download = fact("Browser-observed download rate");
  const unavailable = async () => {
    await expect(upload).toHaveText("Unavailable");
    await expect(download).toHaveText("Unavailable");
  };
  const measured = async () => {
    // The demo sends 3,000 up and 25,000 down per tick. Allow for render scheduling.
    await expect(upload).toHaveText(/^[23]\.\d KB\/s$/);
    await expect(download).toHaveText(/^[23]\d\.\d KB\/s$/);
  };
  await expect(fact("Upload in reported interval")).toHaveText("3.0 KB (3000 B)");
  await expect(fact("Download in reported interval")).toHaveText("25.0 KB (25000 B)");
  await unavailable();
  await measured();

  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  // The browser processes only one scheduled stream tick across this clock gap.
  await page.clock.fastForward(4_000);
  await page.clock.runFor(200);
  await unavailable();
  await page.clock.runFor(2000);
  await measured();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await details.press("Enter");
  await expect(dialog).toBeVisible();
  await unavailable();
});
