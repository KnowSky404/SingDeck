import { expect, test, type Page } from "@playwright/test";
import metadata from "../package.json" with { type: "json" };

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

test("project information is available before and after connecting", async ({
  page,
  isMobile,
}) => {
  if (isMobile) await page.setViewportSize({ width: 260, height: 700 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "About SingDeck" });
  const dialog = page.getByRole("dialog", { name: "About SingDeck" });
  await expect(
    trigger.locator("..").getByRole("link", { name: "SingDeck overview" }),
  ).toBeVisible();
  await expect(trigger).toBeInViewport({ ratio: 1 });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveAccessibleDescription(
    `Dashboard version v${metadata.version}`,
  );
  await expect(
    dialog.getByRole("link", { name: /^KnowSky404 \(/ }),
  ).toHaveAttribute("href", "https://github.com/KnowSky404");
  const repository = dialog.getByRole("link", {
    name: /^KnowSky404\/SingDeck/,
  });
  await expect(repository).toHaveAttribute(
    "href",
    "https://github.com/KnowSky404/SingDeck",
  );
  await expect(repository).toHaveAttribute("target", "_blank");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page.getByText("Mock mode", { exact: true })).toBeVisible();
  if (isMobile) await page.setViewportSize({ width: 280, height: 700 });
  await expect(
    trigger.locator("..").getByRole("link", { name: "SingDeck overview" }),
  ).toBeVisible();
  await expect(trigger).toBeInViewport({ ratio: 1 });
  if (!isMobile) {
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 800, height: 380 });
    const bottom = page.locator(".sidebar-bottom");
    const bottomTrigger = bottom.getByRole("button", {
      name: "About SingDeck",
      exact: true,
    });
    await bottomTrigger.scrollIntoViewIfNeeded();
    await expect(bottomTrigger).toBeInViewport({ ratio: 1 });
    await bottomTrigger.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(bottomTrigger).toBeFocused();
    await page.setViewportSize(viewport);
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(
      trigger.locator("..").getByRole("link", { name: "SingDeck overview" }),
    ).toBeVisible();
  }
  await page
    .getByRole("button", { name: "Display settings", exact: true })
    .click();
  await page.getByRole("radio", { name: "简体中文" }).click();
  await page.getByRole("button", { name: "显示设置", exact: true }).click();
  await page.getByRole("button", { name: "关于 SingDeck" }).click();
  const translated = page.getByRole("dialog", { name: "关于 SingDeck" });
  await expect(translated).toHaveAccessibleDescription(
    `面板版本 v${metadata.version}`,
  );
  await expect(translated.getByText("项目仓库")).toBeVisible();
  await translated.getByRole("button", { name: "关闭" }).click();
  await expect(translated).toBeHidden();
});

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
  const expandPrimary = primary.getByRole("button", {
    name: "Expand Primary route",
    exact: true,
  });
  await expect(expandPrimary).toHaveAccessibleDescription(
    "Selected: Tokyo 01 · Latency 42 ms",
  );
  await expect(page.locator(".proxy-row")).toHaveCount(0);
  await expect(primary).not.toContainText("selector");
  await expandPrimary.click();
  await page
    .getByRole("button", { name: "Expand Auto route", exact: true })
    .click();
  const singapore = primary
    .locator(".proxy-row")
    .filter({ hasText: "Singapore 01" });
  const details = singapore.getByRole("button", {
    name: "Node details for Singapore 01",
  });
  const nodeDialog = page.getByRole("dialog", { name: "Singapore 01" });
  await expect(
    primary
      .locator('[data-slot="card-header"]')
      .getByRole("button", { name: /(Node|Group) details for/ }),
  ).toHaveCount(0);
  const groupReference = primary
    .locator(".proxy-row")
    .filter({ hasText: "Auto route" });
  await expect(
    groupReference.getByRole("button", {
      name: "Select Auto route",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    groupReference.getByRole("button", { name: /Node details for/ }),
  ).toHaveCount(0);
  await groupReference
    .getByRole("button", { name: "Group details for Auto route", exact: true })
    .click();
  const groupDialog = page.getByRole("dialog", {
    name: "Auto route",
    exact: true,
  });
  await expect(groupDialog).toHaveAccessibleDescription(
    "Referenced proxy group",
  );
  await expect(groupDialog.getByText("urltest", { exact: true })).toBeVisible();
  await expect(
    groupDialog.getByText("Singapore 01", { exact: true }),
  ).toBeVisible();
  await expect(groupDialog.getByText("68 ms", { exact: true })).toBeVisible();
  const groupTestTime = await groupDialog
    .locator("time")
    .getAttribute("datetime");
  await groupDialog.getByRole("button", { name: "Close", exact: true }).click();
  await details.click();
  await expect(nodeDialog.getByText("trojan", { exact: true })).toBeVisible();
  await expect(nodeDialog.getByText("68 ms", { exact: true })).toBeVisible();
  await expect(nodeDialog.locator("time")).toHaveAttribute(
    "datetime",
    groupTestTime!,
  );
  await nodeDialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    primary.getByRole("button", { name: "Selected: Tokyo 01", exact: true }),
  ).toBeDisabled();
  await singapore
    .getByRole("button", { name: "Select Singapore 01", exact: true })
    .click();
  await expect(
    singapore.getByRole("button", {
      name: "Selected: Singapore 01",
      exact: true,
    }),
  ).toBeVisible();
  await primary
    .getByRole("button", { name: "Collapse Primary route", exact: true })
    .click();
  await expect(primary.locator(".proxy-row")).toHaveCount(0);
  await expect(expandPrimary).toHaveAccessibleDescription(
    "Selected: Singapore 01 · Latency 68 ms",
  );
  await expect(primary.locator(".proxy-current-latency")).toHaveText("68 ms");
  await expect(details).toBeHidden();
  await expect(
    page
      .locator('[data-slot="card"]')
      .filter({
        has: page
          .locator(".proxy-group-name")
          .filter({ hasText: /^Auto route$/ }),
      })
      .locator(".proxy-row"),
  ).toHaveCount(2);
  await expandPrimary.press("Enter");
  await expect(primary.locator(".proxy-row")).toHaveCount(5);
  const directDetails = primary.getByRole("button", {
    name: "Node details for Direct",
    exact: true,
  });
  await directDetails.press("Enter");
  const directDialog = page.getByRole("dialog", {
    name: "Direct",
    exact: true,
  });
  await expect(
    directDialog.getByText("No result", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(directDialog).toBeHidden();
  await expect(directDetails).toBeFocused();
  await expect(page.locator(".proxy-cards")).toHaveCount(0);
  const testButton = primary.getByRole("button", {
    name: "Test Direct in Primary route",
  });
  await expect(testButton).toBeEnabled();
  await testButton.scrollIntoViewIfNeeded();
  expect(
    await testButton.evaluate((button: HTMLButtonElement) => {
      const { x, y, width, height } = button.getBoundingClientRect();
      button.disabled = true;
      const hit = document.elementFromPoint(x + width / 2, y + height / 2);
      button.disabled = false;
      return hit === button;
    }),
  ).toBe(true);
  await testButton.click();
  await expect(
    primary
      .locator(".proxy-row")
      .filter({ hasText: "Direct" })
      .locator(".proxy-latency"),
  ).toHaveText(/\d+ ms/);
  const londonLatency = page
    .locator(".proxy-row")
    .filter({ hasText: "London 01" })
    .locator(".proxy-latency");
  await expect(londonLatency).toHaveAttribute("data-latency", "unknown");
  await primary
    .getByRole("button", { name: "Test Primary route", exact: true })
    .click();
  await expect(londonLatency).toHaveText("88 ms");
  await expect(groupReference.locator(".proxy-latency")).toHaveText("109 ms");
  await expect(singapore.locator(".proxy-latency")).toHaveText("109 ms");
  await expect(
    singapore.getByRole("button", { name: "Selected: Singapore 01" }),
  ).toBeDisabled();
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
  isMobile,
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
  const originalViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 800, height: 900 });
  const nav = page.getByRole("navigation", {
    name: "Main navigation",
    exact: true,
  });
  for (const label of [
    "Overview",
    "Proxies",
    "Connections",
    "Logs",
    "Settings",
  ])
    await expect(
      nav.getByRole("link", { name: label, exact: true }),
    ).toHaveAccessibleName(label);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await expect(
    nav.getByRole("link", { name: "Overview", exact: true }),
  ).toHaveAccessibleName("Overview");
  await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .click();
  await page.setViewportSize(originalViewport);
  const settingsButton = page.getByRole("button", {
    name: "Display settings",
    exact: true,
  });
  if (isMobile) await settingsButton.focus();
  else await settingsButton.hover();
  await expect(page.getByRole("tooltip")).toHaveText("System theme · English");
  await settingsButton.click();
  const settings = page.getByRole("dialog", { name: "Display settings" });
  const themeOptions = settings
    .getByRole("radiogroup", { name: "Theme" })
    .getByRole("radio");
  await expect(themeOptions).toHaveText(
    isMobile ? ["Light", "Dark", "System"] : ["", "", ""],
    { useInnerText: true },
  );
  await expect(
    settings.getByRole("radio", { name: "System theme", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  const darkTheme = settings.getByRole("radio", {
    name: "Dark theme",
    exact: true,
  });
  if (!isMobile) {
    await darkTheme.hover();
    await expect(
      page.locator('[data-slot="tooltip-content"]').filter({
        hasText: "Dark theme",
      }),
    ).toBeVisible();
  }
  await darkTheme.click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await settings
    .getByRole("radio", { name: "Light theme", exact: true })
    .click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "dark" });
  await settings
    .getByRole("radio", { name: "System theme", exact: true })
    .click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await settingsButton.click();
  await expect(settings).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Connect your network.", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(errors).toEqual([]);
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
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    page.getByText("Connection failed", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByText("Mock mode", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Cancel connection", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "API endpoint", exact: true }),
  ).toBeEnabled();
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

test("entry choices gate the workspace and disconnect returns to the connection form", async ({
  page,
}) => {
  await page.goto("/#/connections");
  await expect(
    page.getByRole("heading", { name: "Connect your network.", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "API endpoint", exact: true }),
  ).toHaveValue("http://127.0.0.1:9090");
  await expect(page.getByLabel("Bearer token", { exact: true })).toHaveValue(
    "",
  );
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Current connection", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Disconnect", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Connect your network.", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("outbound filtering composes with network and search without widening the filter", async ({
  page,
}) => {
  await demo(page);
  await navigate(page, "Connections");
  await page
    .getByRole("combobox", { name: "Outbound filter", exact: true })
    .click();
  await page.getByRole("option", { name: "Singapore 01", exact: true }).click();
  await expect(page.locator(".connection-table tbody tr")).toHaveCount(10);
  await page
    .getByRole("combobox", { name: "Network filter", exact: true })
    .click();
  await page.getByRole("option", { name: "TCP", exact: true }).click();
  await expect(page.locator(".connection-table tbody tr")).toHaveCount(7);
  await page
    .getByRole("textbox", { name: "Search connections" })
    .fill("cdn.example.org");
  await expect(page.locator(".connection-table tbody tr")).toHaveCount(2);
  for (const row of await page.locator(".connection-table tbody tr").all())
    await expect(row.locator("td").nth(2)).toContainText("Singapore 01");
  await page
    .getByRole("textbox", { name: "Search connections" })
    .fill("no-such-destination");
  await expect(page.getByText("Nothing to show yet")).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Outbound filter", exact: true }),
  ).toHaveText("Singapore 01");
  await page.getByRole("textbox", { name: "Search connections" }).clear();
  await page
    .getByRole("combobox", { name: "Outbound filter", exact: true })
    .click();
  await page
    .getByRole("option", { name: "All outbounds", exact: true })
    .click();
  await expect(page.locator(".connection-table tbody tr")).toHaveCount(21);
});

test("ANSI logs render colors and export plain text", async ({ page }) => {
  await demo(page);
  await navigate(page, "Logs");
  await page.getByRole("combobox", { name: "Log level", exact: true }).click();
  await page.getByRole("option", { name: "All levels", exact: true }).click();
  const line = page
    .locator(".log-line")
    .filter({ hasText: "1679805080" })
    .first();
  await expect(line).toBeVisible();
  await expect(line.locator(".log-message")).not.toContainText("[37m");
  await expect(
    line.locator(".log-message span").filter({ hasText: /^1679805080$/ }),
  ).toHaveCSS("color", "rgb(215, 95, 135)");
  await page.getByRole("textbox", { name: "Search logs" }).fill("DEBUG[16737]");
  await expect(page.locator(".log-line")).toHaveCount(1);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export filtered logs" }).click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  expect(text).toContain("DEBUG[16737]");
  expect(text).not.toContain("\u001b");
  expect(text).not.toContain("[38;5;168m");
});

test("group cards and node cards are independent and settings stay read-only", async ({
  page,
}, info) => {
  await demo(page);
  await expect(
    page.getByRole("combobox", { name: "Active instance", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".page-heading")).toHaveCount(0);
  if (info.project.name === "desktop") {
    await page
      .getByRole("link", { name: "Overview", exact: true })
      .first()
      .hover();
    await expect(page.getByRole("tooltip")).toContainText(
      "Your network, at a glance.",
    );
  }
  await navigate(page, "Proxies");
  await expect(page.getByRole("radio", { name: "Group cards" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "List view" })).toBeChecked();
  await expect(page.locator(".proxy-group-grid > div")).toHaveCount(2);
  const primaryGroup = page.getByRole("button", {
    name: "Expand Primary route",
    exact: true,
  });
  expect(
    await primaryGroup.locator(".proxy-current-name").evaluate((element) => {
      const name = element.textContent;
      element.textContent = "very-long-selected-node-name".repeat(12);
      const summary = element.closest(".proxy-group-current")!;
      const copy = element.closest(".proxy-group-copy")!;
      const fits =
        summary.getBoundingClientRect().right <=
          copy.getBoundingClientRect().right &&
        element.scrollWidth > element.clientWidth;
      element.textContent = name;
      return fits;
    }),
  ).toBe(true);
  const rows = page.locator(".proxy-items .proxy-row");
  await expect(rows).toHaveCount(0);
  const search = page.getByRole("textbox", { name: "Search outbounds" });
  await search.fill("London");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("London 01");
  await page
    .getByRole("button", { name: "Collapse Auto route", exact: true })
    .click();
  await expect(rows).toHaveCount(0);
  await search.clear();
  await expect(primaryGroup).toBeVisible();
  await search.fill("London");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("London 01");
  await search.clear();
  await primaryGroup.click();
  await page
    .getByRole("button", { name: "Expand Auto route", exact: true })
    .click();
  await expect(page.locator(".proxy-cards")).toHaveCount(0);
  await expect(rows).toHaveCount(7);
  const rowHeights = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().height),
  );
  expect(Math.max(...rowHeights)).toBeLessThanOrEqual(40);
  const referenceName = rows
    .filter({ hasText: "Auto route" })
    .locator("strong");
  expect(
    await referenceName.evaluate((element) => {
      const name = element.textContent;
      const height = element.clientHeight;
      element.textContent = "A very long group reference name ".repeat(8);
      const protocol = element.nextElementSibling!;
      const identity = element.parentElement!.getBoundingClientRect();
      const wrapped =
        element.clientHeight > height &&
        element.scrollWidth <= element.clientWidth &&
        protocol.clientWidth >= protocol.scrollWidth &&
        protocol.clientWidth > 0 &&
        protocol.getBoundingClientRect().right <= identity.right;
      element.textContent = name;
      return wrapped;
    }),
  ).toBe(true);
  await page.getByRole("radio", { name: "Compact cards", exact: true }).click();
  await expect(page.locator(".proxy-cards")).toHaveCount(2);
  const tiles = page.locator(".proxy-cards .proxy-row");
  await expect(tiles).toHaveCount(7);
  expect(
    await tiles
      .first()
      .locator("strong")
      .evaluate((element) => {
        const name = element.textContent;
        element.textContent = "very-long-node-name".repeat(12);
        const truncated =
          element.clientWidth <= element.parentElement!.clientWidth &&
          element.scrollWidth > element.clientWidth &&
          getComputedStyle(element).textOverflow === "ellipsis";
        element.textContent = name;
        return truncated;
      }),
  ).toBe(true);
  await expect(
    tiles.filter({ hasText: "Auto route" }).getByRole("button", {
      name: "Group details for Auto route",
      exact: true,
    }),
  ).toBeVisible();
  const sizes = await tiles.evaluateAll((nodes) =>
    nodes.map((node) => {
      const { width, height } = node.getBoundingClientRect();
      return { width, height };
    }),
  );
  for (const size of sizes) {
    expect(Math.abs(size.width - sizes[0].width)).toBeLessThan(1);
    expect(Math.abs(size.height - sizes[0].height)).toBeLessThan(1);
  }
  await expect(page.locator(".proxy-group-grid > div")).toHaveCount(2);
  await page.getByRole("radio", { name: "Group list", exact: true }).click();
  await expect(page.locator(".proxy-group-grid")).toHaveCount(0);
  await expect(page.locator(".proxy-cards")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Collapse Primary route", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Expand Primary route", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await navigate(page, "Settings");
  await expect(
    page.getByText("Instance details", { exact: true }),
  ).toBeVisible();
  for (const text of [
    "Instance connection",
    "Development sandbox",
    "Appearance",
  ])
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Download dashboard", exact: true }),
  ).toBeVisible();
});

test("INFO threshold hides debug and trace while retaining warnings and errors", async ({
  page,
}) => {
  await demo(page);
  await navigate(page, "Logs");
  await expect(
    page.getByRole("combobox", { name: "Log level", exact: true }),
  ).toHaveText("INFO and above");
  await expect(
    page.getByText("demo warning: retrying a probe", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("demo error: simulated probe failure", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".log-line").filter({ hasText: "demo trace" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".log-line").filter({ hasText: "DEBUG[16737]" }),
  ).toHaveCount(0);
  await page.getByRole("combobox", { name: "Log level", exact: true }).click();
  await page.getByRole("option", { name: "All levels", exact: true }).click();
  await expect(
    page.getByText("demo trace: route lookup", { exact: true }),
  ).toBeVisible();
});

test("connection state filter retains closed records and disables close actions on them", async ({
  page,
}) => {
  await demo(page);
  await navigate(page, "Connections");
  await expect(
    page.getByRole("combobox", { name: "Status filter", exact: true }),
  ).toHaveText("Active");
  await expect(page.locator(".connection-table tbody tr")).toHaveCount(28);
  await page.getByRole("button", { name: "Close mock-1", exact: true }).click();
  await expect(page.locator(".connection-table tbody tr")).toHaveCount(27);
  await page
    .getByRole("combobox", { name: "Status filter", exact: true })
    .click();
  await page.getByRole("option", { name: "Closed", exact: true }).click();
  await expect(page.locator(".connection-table tbody tr")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "Close mock-1", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Details for mock-1", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Closed");
  await page.keyboard.press("Escape");
  await page
    .getByRole("combobox", { name: "Network filter", exact: true })
    .click();
  await page.getByRole("option", { name: "TCP", exact: true }).click();
  await expect(
    page.getByText("Nothing to show yet", { exact: true }),
  ).toBeVisible();
});

test("language and theme controls work without replacing the session and persist across reload", async ({
  page,
  isMobile,
}) => {
  await demo(page);
  const settingsButton = page.getByRole("button", {
    name: "Display settings",
    exact: true,
  });
  await settingsButton.focus();
  await expect(page.getByRole("tooltip")).toHaveText("System theme · English");
  await settingsButton.press("Enter");
  const languages = page.getByRole("radiogroup", { name: "Language" });
  await expect(languages.getByText("English", { exact: true })).toHaveCount(1);
  if (isMobile)
    await expect(languages.getByText("English", { exact: true })).toBeVisible();
  else
    await expect(languages.getByRole("radio")).toHaveText(["A", "中"], {
      useInnerText: true,
    });
  await expect(
    page.getByRole("radio", { name: "System theme", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    languages.getByRole("radio", { name: "English", exact: true }),
  ).toBeFocused();
  await page.keyboard.down("ArrowRight");
  const chinese = page.getByRole("radio", {
    name: "简体中文",
    exact: true,
  });
  await expect(chinese).toBeFocused();
  await expect(chinese).toBeChecked();
  await page.keyboard.up("ArrowRight");
  await expect(
    page.locator('[data-slot="tooltip-content"]').filter({
      hasText: "简体中文",
    }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByText("演示模式", { exact: true })).toBeVisible();
  const translatedSettingsButton = page.getByRole("button", {
    name: "显示设置",
    exact: true,
  });
  await page
    .getByRole("dialog", { name: "显示设置" })
    .getByRole("radio", { name: "深色主题", exact: true })
    .click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await translatedSettingsButton.click();
  const collapse = page.getByRole("button", { name: "收起侧栏", exact: true });
  if (await collapse.isVisible()) {
    await collapse.click();
    await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
  }
  for (const name of ["代理", "连接", "日志", "设置", "概览"]) {
    await navigate(page, name);
    await expect(page.getByRole("heading", { name, exact: true })).toHaveClass(
      "sr-only",
    );
  }
  await page.getByRole("button", { name: "当前连接", exact: true }).click();
  await expect(page.getByRole("menu")).toContainText("演示实例");
  await expect(page).toHaveURL(/#\/$/);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "当前连接", exact: true }).click();
  await page.getByRole("menuitem", { name: "退出连接", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "连接", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("访问密钥", { exact: true })).toHaveValue("");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await translatedSettingsButton.focus();
  await expect(page.getByRole("tooltip")).toHaveText("深色主题 · 简体中文");
  await translatedSettingsButton.click();
  await page.getByRole("radio", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Explore demo", exact: true }),
  ).toBeVisible();
});
