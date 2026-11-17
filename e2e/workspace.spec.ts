import { expect, test, type Page } from "@playwright/test";

async function demo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Connected$/ }),
  ).toBeVisible();
  await expect(page.getByText("Mock mode", { exact: true })).toBeVisible();
}
async function navigate(page: Page, name: string) {
  await page.getByRole("link", { name, exact: true }).first().click();
}

test("mock workspace supports server-confirmed selection, filtering, log controls and safe connection actions", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await demo(page);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await navigate(page, "Proxies");
  const primary = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText("Primary route", { exact: true }) });
  const singapore = primary
    .locator(".proxy-row")
    .filter({ hasText: "Singapore 01" });
  await singapore.getByRole("button", { name: "Select", exact: true }).click();
  await expect(
    singapore.getByRole("button", { name: "Selected", exact: true }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Compact cards" }).click();
  await expect(page.locator(".proxy-cards")).toHaveCount(2);
  await page
    .getByRole("textbox", { name: "Search outbounds" })
    .fill("no-such-node");
  await expect(page.getByText("No outbounds match your filters.")).toHaveCount(
    2,
  );
  await navigate(page, "Logs");
  await expect(page.locator(".log-line").first()).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByText("View paused")).toBeVisible();
  const logs = await page.locator(".log-line").count();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Search logs" }).fill("no-such-log");
  await expect(page.getByText("Nothing to show yet")).toBeVisible();
  await page.getByRole("textbox", { name: "Search logs" }).clear();
  await expect(page.locator(".log-line")).toHaveCount(logs);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export filtered logs" }).click();
  expect((await download).suggestedFilename()).toMatch(/^singdeck-logs-/);
  await page.getByRole("button", { name: "Clear local logs" }).click();
  await expect(page.getByText("Nothing to show yet")).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await navigate(page, "Connections");
  await expect(
    page.getByRole("button", { name: "Details for mock-1", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Details for mock-1", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Connection details");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Close mock-1", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Details for mock-1", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Close all connections", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Details for mock-2", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close all connections", exact: true })
    .click();
  await page.getByRole("button", { name: "Close all", exact: true }).click();
  await expect(page.getByText("Nothing to show yet")).toBeVisible();
  expect(errors).toEqual([]);
});

test("responsive layout, dark/light/system themes, routes and console health", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  await demo(page);
  await expect(page).toHaveTitle("SingDeck · Network workspace");
  await page.keyboard.press("Tab");
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  for (const name of [
    "Proxies",
    "Connections",
    "Logs",
    "Settings",
    "Overview",
  ]) {
    await navigate(page, name);
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  }
  await navigate(page, "Settings");
  await page.getByRole("radio", { name: "dark theme", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("radio", { name: "light theme", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("radio", { name: "system theme", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(errors).toEqual([]);
});

test("mock outage recovers and mutation rejection does not change the selected node", async ({
  page,
}) => {
  await demo(page);
  await navigate(page, "Settings");
  await page
    .getByRole("switch", { name: "Simulate disconnect", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Reconnecting$/ }),
  ).toBeVisible({ timeout: 10000 });
  await page
    .getByRole("switch", { name: "Simulate disconnect", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Connected$/ }),
  ).toBeVisible({ timeout: 15000 });
  await page
    .getByRole("switch", { name: "Fail next mutation", exact: true })
    .click();
  await navigate(page, "Proxies");
  const primary = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText("Primary route", { exact: true }) });
  await primary
    .locator(".proxy-row")
    .filter({ hasText: "Singapore 01" })
    .getByRole("button", { name: "Select", exact: true })
    .click();
  await expect(page.getByText("Selection failed")).toBeVisible();
  await expect(
    primary
      .locator(".proxy-row")
      .filter({ hasText: "Tokyo 01" })
      .getByRole("button", { name: "Selected", exact: true }),
  ).toBeVisible();
});

test("native failures remain native and credentials never enter persistent storage", async ({
  page,
}) => {
  await page.goto("/#/settings");
  await page
    .getByRole("textbox", { name: "API endpoint", exact: true })
    .fill("http://127.0.0.1:19999");
  await page
    .getByLabel("Bearer token", { exact: true })
    .fill("e2e-private-credential");
  await page
    .getByRole("switch", { name: "Automatically reconnect", exact: true })
    .click();
  await page.getByRole("button", { name: "Save & connect" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Connection failed$/ }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Mock mode", { exact: true })).toHaveCount(0);
  const persisted = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(persisted).not.toContain("e2e-private-credential");
  expect(page.url()).not.toContain("e2e-private-credential");
  await page.reload();
  await expect(page.getByLabel("Bearer token", { exact: true })).toHaveValue(
    "",
  );
});
