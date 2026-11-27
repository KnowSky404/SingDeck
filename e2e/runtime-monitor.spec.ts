import { expect, test } from "@playwright/test";

test("runtime monitor shows live metrics and lets the user change the history window", async ({
  page,
  isMobile,
}) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page.getByText("Mock mode", { exact: true })).toBeVisible();

  const entry = page.getByRole("link", { name: "View runtime monitor" });
  await entry.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/runtime-monitor$/);
  const main = page.getByRole("main");
  const heading = main.getByRole("heading", { name: "Runtime monitor", exact: true });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  await expect.poll(async () => (await heading.boundingBox())?.height ?? 0).toBeGreaterThan(20);
  if (!isMobile) await expect(heading).toHaveCSS("outline-style", "solid");
  const current = main.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", { name: "Current runtime", exact: true }),
  });
  for (const metric of [
    "Memory",
    "Goroutines",
    "Inbound connections",
    "Outbound connections",
    "Download",
    "Upload",
  ]) {
    await expect(current.getByText(metric, { exact: true })).toBeVisible();
  }
  await expect(current.getByText("78", { exact: true })).toBeVisible();
  await expect(current.getByText("28", { exact: true })).toHaveCount(2);

  const service = main.getByRole("row", { name: /^Service lifecycle\b/ });
  const groups = main.getByRole("row", { name: /^Groups\b/ });
  const groupsTime = groups.locator("time");
  await expect(service.getByText("Live", { exact: true })).toBeVisible();
  await expect(groups.getByText("Live", { exact: true })).toBeVisible();
  await expect(groupsTime).toHaveAttribute("datetime", /\d/);
  const groupsReceivedAt = await groupsTime.getAttribute("datetime");
  for (let seconds = 0; seconds < 12; seconds += 2) {
    await page.clock.fastForward(2_000);
  }
  await expect(service.getByText("Live", { exact: true })).toBeVisible();
  await expect(groups.getByText("Live", { exact: true })).toBeVisible();
  await expect(groupsTime).toHaveAttribute("datetime", groupsReceivedAt!);
  await expect(current.getByText(/^[\d.]+ [KMGT]?B\/s$/).first()).toBeVisible();
  await expect(main.getByText("Service: Running", { exact: true })).toHaveCount(1);
  await expect(main.getByText("Runtime data is stale", { exact: true })).toHaveCount(0);

  const historyWindow = main.getByRole("combobox", { name: "History window" });
  await expect(historyWindow).toHaveText("1 minute");
  const fiveMinutes = page.getByRole("option", { name: "5 minutes", exact: true });
  if (isMobile) {
    await historyWindow.tap();
    await expect(page.getByRole("option")).toHaveCount(3);
    await fiveMinutes.tap();
  } else {
    await page.keyboard.press("Tab");
    await expect(historyWindow).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("option")).toHaveCount(3);
    await expect(page.getByRole("option", { name: "1 minute", exact: true })).toBeFocused();
    await page.keyboard.press("End");
    await expect(fiveMinutes).toBeFocused();
    await page.keyboard.press("Enter");
  }
  await expect(historyWindow).toHaveText("5 minutes");
  for (const name of [
    "Traffic rate history",
    "Memory history",
    "Goroutines history",
    "Connection count history",
  ]) {
    const region = main.getByRole("region", { name, exact: true });
    const chart = region.getByRole("application", { name, exact: true });
    await expect(chart).toBeVisible();
    await expect(chart.locator("path[d]").first()).toHaveAttribute("d", /^M.+L/);
  }
  if (!isMobile) {
    await expect(historyWindow).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(main.getByRole("button", { name: "Clear older chart samples", exact: true })).toBeFocused();
    for (const name of ["Traffic rate history", "Connection count history", "Memory history"]) {
      await page.keyboard.press("Tab");
      await expect(main.getByRole("application", { name, exact: true })).toBeFocused();
    }
    const memoryHistory = main.getByRole("region", { name: "Memory history" });
    const tooltip = memoryHistory.getByRole("status");
    await expect(tooltip).toContainText(/Memory.*\d.*MB/);
    await expect(memoryHistory.locator(".recharts-active-dot circle")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(tooltip).toBeHidden();
    await page.keyboard.press("Enter");
    await expect(tooltip).toBeVisible();
  }
  await expect
    .poll(() => page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ))
    .toBe(true);
  const beforePause = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(beforePause + 3000);
  await page.clock.setSystemTime(beforePause + 310_000);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(main.getByRole("application", { name: "Traffic rate history" })).toHaveCount(0);
  await expect(main.getByRole("application", { name: "Memory history" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("runtime chart keeps isolated markers and separates contiguous segments across a gap", async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page.getByText("Mock mode", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "View runtime monitor" }).click();

  const region = page.getByRole("region", { name: "Memory history", exact: true });
  const chart = region.getByRole("application", { name: "Memory history", exact: true });
  const markers = chart.locator(".recharts-line-dots circle");
  const curve = chart.locator("path.recharts-line-curve");
  await expect(chart).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
  await page.clock.runFor(2_000);
  await expect(curve).toHaveAttribute("d", /^M[^M]*L[^M]*$/);
  await expect(markers).toHaveCount(0);

  // One elapsed status tick after the stale interval creates an actual observed gap.
  await page.clock.fastForward(4_000);
  await page.clock.runFor(200);
  await expect(page.getByText("Chart gaps show interruptions in observed data.")).toBeVisible();
  await expect(markers).toHaveCount(1);
  await expect(markers).toBeVisible();

  await page.clock.runFor(1_000);
  await expect(curve).toHaveAttribute("d", /^(?:M[^M]*L[^M]*){2}$/);
  await expect(markers).toHaveCount(0);
});

test("clears older chart points without interrupting live runtime readings", async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page.getByText("Mock mode", { exact: true })).toBeVisible();
  await page.clock.runFor(125_000);

  const goToRuntime = () => page.getByRole("link", { name: "View runtime monitor", exact: true }).click();
  await goToRuntime();
  const clear = page.getByRole("button", { name: "Clear older chart samples", exact: true });
  const window = page.getByRole("combobox", { name: "History window", exact: true });
  const memory = page.getByRole("region", { name: "Memory history", exact: true });
  const curve = memory.locator("path.recharts-line-curve");
  const pointCount = () => curve.evaluate(element => (element.getAttribute("d")?.match(/[ML]/g) ?? []).length);
  const marker = memory.locator(".recharts-line-dots circle");
  const status = page.getByRole("row", { name: /^Runtime status\b/ });
  const receipt = status.locator("time");
  const current = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", { name: "Current runtime", exact: true }),
  }).locator("dl");
  const event = page.getByText("Service: Running", { exact: true });

  await expect(memory).toBeVisible();
  await expect(curve).toHaveCount(1);
  await expect.poll(pointCount).toBeGreaterThan(45);
  await expect(clear).toBeEnabled();
  await clear.scrollIntoViewIfNeeded();
  expect(await clear.evaluate(node => {
    const { left, right, width } = node.getBoundingClientRect();
    return width > 0 && left >= 0 && right <= document.documentElement.clientWidth;
  })).toBe(true);

  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1500));
  await page.clock.runFor(150);
  const age = await page.evaluate(() => Date.now()) - Date.parse((await receipt.getAttribute("datetime"))!);
  // Move past the next publication if the frozen clock landed near a status tick.
  if (age >= 850) await page.clock.runFor(Math.max(150, 1300 - age));
  const beforeReceipt = await receipt.getAttribute("datetime");
  expect(beforeReceipt).toBeTruthy();
  const beforeReadings = await current.innerText();
  await expect(event).toHaveCount(1);
  if (isMobile) await clear.tap({ force: true });
  else {
    await clear.focus();
    await page.keyboard.press("Enter");
    await expect(clear).toBeFocused();
  }
  await expect(clear).toBeDisabled();
  await expect(curve).toHaveCount(0);
  await expect(marker).toHaveCount(1);
  await expect(marker).toBeVisible();
  await expect(status.getByText("Live", { exact: true })).toBeVisible();
  await expect(receipt).toHaveAttribute("datetime", beforeReceipt!);
  await expect.poll(() => current.innerText()).toBe(beforeReadings);
  await expect(event).toHaveCount(1);

  await page.clock.runFor(2100);
  await expect(clear).toBeEnabled();
  await expect(curve).toHaveCount(1);
  await expect.poll(async () => [3, 4].includes(await pointCount())).toBe(true);
  await expect(receipt).not.toHaveAttribute("datetime", beforeReceipt!);
  const onlyNewPoints = async (...counts: number[]) => {
    const elapsed = await page.evaluate(() => Date.now()) - Date.parse(beforeReceipt!);
    const limit = 1 + Math.floor(elapsed / 1000);
    return counts.every(count => count >= 3 && count <= limit);
  };

  await page.clock.resume();
  if (isMobile) await window.tap();
  else await window.press("Enter");
  const fiveMinutes = page.getByRole("option", { name: "5 minutes", exact: true });
  if (isMobile) await fiveMinutes.tap();
  else {
    await page.keyboard.press("End");
    await expect(fiveMinutes).toBeFocused();
    await page.keyboard.press("Enter");
  }
  await expect(window).toHaveText("5 minutes");
  await expect.poll(async () => onlyNewPoints(await pointCount())).toBe(true);
  await page.getByRole("link", { name: "Overview", exact: true }).first().click();
  const overviewCurves = page.getByRole("img", { name: /^Traffic history\./ }).locator("path.recharts-area-curve");
  await expect(overviewCurves).toHaveCount(2);
  await expect.poll(async () => onlyNewPoints(...await overviewCurves.evaluateAll(paths => paths.map(path =>
    path.getAttribute("d")?.match(/[MCL]/g)?.length ?? 0,
  )))).toBe(true);
  await goToRuntime();
  await expect(window).toHaveText("1 minute");
  await expect(curve).toHaveCount(1);
  await expect.poll(async () => onlyNewPoints(await pointCount())).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
