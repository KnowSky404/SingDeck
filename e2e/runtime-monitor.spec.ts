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
    for (const name of ["Traffic rate history", "Connection count history", "Memory history"]) {
      await page.keyboard.press("Tab");
      await expect(main.getByRole("application", { name, exact: true })).toBeFocused();
    }
    const tooltip = main.getByRole("region", { name: "Memory history" }).getByRole("status");
    await expect(tooltip).toContainText(/Memory.*\d.*MB/);
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
  expect(errors).toEqual([]);
});
