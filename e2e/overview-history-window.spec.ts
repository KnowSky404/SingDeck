import { expect, test, type Locator } from "@playwright/test";

test("Overview changes the samples shown without saving the window or reviving expired history", async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page.getByText("Mock mode", { exact: true })).toBeVisible();

  const navigate = async (name: "Settings" | "Overview") => {
    if (name === "Settings" && isMobile)
      await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page.getByRole("link", { name, exact: true }).first().click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  };
  const history = page.getByRole("combobox", { name: "History window", exact: true });
  const chart = page.getByRole("img", { name: /^Traffic history\./ });
  const curves = chart.locator("path.recharts-area-curve");
  const empty = page.getByText("Collecting traffic samples", { exact: true });
  const option = (name: string) => page.getByRole("option", { name, exact: true });
  const contained = (locator: Locator) => expect.poll(() => locator.evaluate(node => {
    const { left, right, width, top, bottom, height } = node.getBoundingClientRect();
    return width > 0 && height > 0 && left >= 0 && right <= document.documentElement.clientWidth &&
      top >= 0 && bottom <= document.documentElement.clientHeight;
  })).toBe(true);

  // Populate the existing session history off-chart to avoid rendering 305 intermediate SVGs.
  await navigate("Settings");
  await page.clock.runFor(305_000);
  await navigate("Overview");
  const expectPoints = async (maximum: number) => {
    await expect(curves).toHaveCount(2);
    await expect.poll(async () => (await curves.evaluateAll(nodes => nodes.map(node =>
      // A contiguous monotone SVG curve uses one M followed by one C per further point.
      node.getAttribute("d")?.match(/[MCL]/g)?.length ?? 0,
    ))).map(count => count >= maximum - 1 && count <= maximum)).toEqual([true, true]);
  };
  const open = async () => {
    await history.scrollIntoViewIfNeeded();
    if (isMobile) await history.tap();
    else {
      await history.focus();
      await page.keyboard.press("Enter");
    }
    await expect(page.getByRole("option")).toHaveText(["1 minute", "3 minutes", "5 minutes"]);
    await contained(option("1 minute"));
    await contained(option("5 minutes"));
  };
  const choose = async (previous: string, next: string, key: string) => {
    await open();
    if (isMobile) await option(next).tap();
    else {
      await expect(option(previous)).toBeFocused();
      await page.keyboard.press(key);
      await expect(option(next)).toBeFocused();
      await page.keyboard.press("Enter");
    }
    await expect(history).toHaveText(next);
    await contained(history);
    if (!isMobile) {
      await expect(history).toBeFocused();
      await expect(history).not.toHaveCSS("box-shadow", "none");
    }
  };

  await expect(history).toHaveText("1 minute");
  await expectPoints(60);
  await choose("1 minute", "3 minutes", "ArrowDown");
  await expectPoints(180);
  await choose("3 minutes", "5 minutes", "End");
  await expectPoints(300);
  const previousCurve = await curves.first().getAttribute("d");
  await page.clock.runFor(2200);
  await expect.poll(() => curves.first().getAttribute("d")).not.toBe(previousCurve);
  await expect(history).toHaveText("5 minutes");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await navigate("Settings");
  await navigate("Overview");
  await expect(history).toHaveText("1 minute");
  await expectPoints(60);

  // Keep the picker mounted and stop new status ticks before testing two ages of the same samples.
  await open();
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 150);
  await page.clock.setSystemTime(now + 75_000);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(empty).toBeVisible();
  await expect(chart).toHaveCount(0);
  await page.clock.setSystemTime(now + 310_000);
  await option("5 minutes").press("Enter");
  await expect(history).toHaveText("5 minutes");
  await expect(empty).toBeVisible();
  await expect(chart).toHaveCount(0);
});

test("Overview marks retained readings stale before a quiet status stream reconnects", async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page.getByText("Mock mode", { exact: true })).toBeVisible();

  const main = page.getByRole("main");
  const stale = main.getByText("Runtime data is stale", { exact: true });
  const chart = main.getByRole("img", { name: /^Traffic history\./ });
  const currentName = /^Traffic history\. Current download \d.+ per second; upload \d.+ per second\.$/;
  const curves = chart.locator("path.recharts-area-curve");
  const cards = main.locator(".metrics-grid .metric strong");
  const connection = page.locator(".connection-status");
  const viewRuntime = main.getByRole("link", { name: "View runtime monitor", exact: true });
  await expect(curves).toHaveCount(2);
  // Load both routes before freezing the clock so lazy page loading can finish normally.
  await viewRuntime.press("Enter");
  await expect(main.getByRole("heading", { name: "Current runtime", exact: true })).toBeVisible();
  await page.goBack();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
  await expect(chart).toHaveAccessibleName(currentName);
  await expect(stale).toHaveCount(0);
  await expect(cards).toHaveCount(4);
  const readings = await cards.allTextContents();
  expect(readings.every(value => /^\d/.test(value))).toBe(true);
  const lastObservedName = (await chart.getAttribute("aria-label"))!
    .replace("Current download", "Last observed download") + " Readings are stale.";

  // Age the last sample past the three-second limit without delivering another status frame.
  await page.clock.setSystemTime(await page.evaluate(() => Date.now() + 4_000));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.clock.runFor(1);
  await expect(connection).toHaveText("Connected");
  await expect(stale).toBeVisible();
  await expect(chart).toHaveAccessibleName(lastObservedName);
  await expect(cards).toHaveText(readings);
  await expect(curves).toHaveCount(2);

  await viewRuntime.press("Enter");
  await expect(main.getByRole("heading", { name: "Last observed runtime", exact: true })).toBeVisible();
  await expect(stale).toBeVisible();
  await page.goBack();
  await expect(stale).toBeVisible();
  await expect(chart).toHaveAccessibleName(lastObservedName);

  // The first status frame after the gap restores freshness. The next frame restores rates.
  await page.clock.runFor(2_200);
  await expect(stale).toHaveCount(0);
  await expect(connection).toHaveText("Connected");
  await expect(chart).toHaveAccessibleName(currentName);
});
