import { expect, test } from "@playwright/test";

test("connection details show the reported route and retained closed state", async ({
  page,
  isMobile,
}) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  await page.addInitScript(() => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (value: string) => {
          copied = value;
        },
        readText: async () => copied,
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page.getByText("Mock mode", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Connections", exact: true }).first().click();

  const details = page.getByRole("button", {
    name: "Details for mock-1",
    exact: true,
  });
  const dialog = page.getByRole("dialog", {
    name: "Connection details",
    exact: true,
  });
  const header = dialog.locator('[data-slot="dialog-header"]');
  await details.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Connection details" })).toBeFocused();
  await expect(header).toContainText(/\bActive\b/);
  const fields = dialog.getByRole("region", { name: "Reported connection fields" });
  await page.keyboard.press("Tab");
  await expect(fields).toBeFocused();
  if (isMobile) {
    await page.keyboard.press("PageDown");
    await expect.poll(() => fields.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press("Home");
  }

  const fact = (label: string) =>
    dialog
      .locator("dt")
      .filter({ hasText: new RegExp(`^${label}$`) })
      .locator("..")
      .locator("dd");
  await expect(fact("Connection ID")).toHaveText("mock-1");
  await expect(fact("Inbound type")).toHaveText("mixed");
  await expect(fact("Outbound type")).toHaveText("vless");
  await expect(fact("Source address")).toHaveText("127.0.0.1:50000");
  await expect(fact("Destination address")).toHaveText("203.0.113.1:443");
  await expect(fact("Domain")).toHaveText("api.github.com");
  await expect(fact("Matched rule")).toHaveText("inbound=mixed-in");
  await expect(fact("IP version")).toHaveText(/^(?:IPv)?4$/i);
  await expect(fact("From outbound")).toHaveText("Unavailable");
  await expect(fact("Process ID")).toHaveText("Unavailable");
  await expect(fact("Created at").locator("time")).toHaveAttribute(
    "datetime",
    /T.*Z$/,
  );
  await expect(fact("Created at").locator("time")).toHaveText(/\d{2}:\d{2}:\d{2}\.\d{3}/);
  await expect(fact("Closed at")).toHaveText("Unavailable");
  await expect(fact("Download total")).toHaveText(/^[\d.]+ [KMGT]B \(\d+ B\)$/);
  await expect(fact("Upload in reported interval")).toHaveText("3.0 KB (3000 B)");
  await expect(fact("Download in reported interval")).toHaveText("25.0 KB (25000 B)");

  const route = dialog.getByRole("region", { name: "Route", exact: true });
  await expect(route.getByRole("list")).toBeVisible();
  await expect(route).toContainText(
    /mixed-in.*inbound=mixed-in.*Primary route.*Singapore 01.*203\.0\.113\.1:443/s,
  );
  await expect(route).not.toContainText("Process");
  for (const [name, expected] of [
    ["Copy domain", "api.github.com"],
    ["Copy outbound chain", "Primary route → Singapore 01"],
  ]) {
    await dialog.getByRole("button", { name, exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(expected);
    await expect(dialog.getByText("Copied to clipboard.", { exact: true })).toBeVisible();
  }
  expect(
    await dialog.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= document.documentElement.clientWidth;
    }),
  ).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(details).toBeFocused();
  await page.getByRole("button", { name: "Close mock-1", exact: true }).click();
  await expect(details).toHaveCount(0);
  await page.getByRole("combobox", { name: "Status filter", exact: true }).click();
  await page.getByRole("option", { name: "Closed", exact: true }).click();
  await details.click();
  await expect(header).toContainText(/\bClosed\b/);
  await expect(fact("Closed at").locator("time")).toHaveAttribute(
    "datetime",
    /T.*Z$/,
  );
  await expect(route).toContainText(/Primary route.*Singapore 01/s);
  await expect(fact("Download total")).toHaveText(/^[\d.]+ [KMGT]B \(\d+ B\)$/);
  await expect(fact("Upload in reported interval")).toHaveText("Unavailable");
  await expect(fact("Download in reported interval")).toHaveText("Unavailable");
});

test("connection filters compose with search and reset to all active rows", async ({
  page,
  isMobile,
}) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await page.getByRole("link", { name: "Connections", exact: true }).first().click();

  const choose = async (label: string, option: string) => {
    await page.getByRole("combobox", { name: label, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  const field = (label: string) => page.getByRole("textbox", { name: label, exact: true });
  const matching = (count: number) =>
    expect(page.getByText(new RegExp(`^${count} matching connections\\b`))).toBeVisible();

  await matching(28);
  await choose("Status filter", "All statuses");
  await matching(30);
  await choose("Network filter", "TCP");
  await choose("Outbound filter", "Tokyo 01");
  await matching(14);

  const advanced = page.getByRole("button", { name: "Advanced filters", exact: true });
  await advanced.focus();
  await page.keyboard.press("Enter");
  await expect(advanced).toBeFocused();
  await expect(advanced).toHaveAttribute("aria-expanded", "true");

  await field("Domain").fill("cdn.example.org");
  await matching(5);
  await choose("IP version", "IPv6");
  await matching(0);
  await choose("IP version", "IPv4");
  await matching(5);

  for (const [label, absent, reported] of [
    ["Inbound", "unreported-inbound", "mixed-in"],
    ["Protocol", "quic", "tls"],
    ["Matched rule", "inbound=unreported", "inbound=mixed-in"],
    ["Process", "unavailable", ""],
    ["User", "unavailable", ""],
  ]) {
    await field(label).fill(absent);
    await matching(0);
    await field(label).fill(reported);
    await matching(5);
  }

  const search = field("Search connections");
  await search.fill("  TOKYO   cdn.example.org  127.0.0.1:50001  ");
  await matching(1);
  await expect(page.getByRole("button", { name: "Details for mock-2", exact: true })).toBeVisible();
  await choose("Status filter", "Closed");
  await matching(0);

  await page.getByRole("button", { name: "Clear filters", exact: true }).press("Enter");
  await matching(28);
  await expect(search).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Status filter", exact: true })).toHaveText("Active");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    (await page.viewportSize())!.width,
  );
});

test("configures connection columns by keyboard and keeps a visible sort", async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await page.getByRole("link", { name: "Connections", exact: true }).first().click();

  const table = page.locator(".connection-table");
  const rows = table.locator("tbody tr");
  const allColumns = ["Destination", "Network", "Outbound", "Status", "Start time", "Upload", "Download", "Actions"];
  const expectLayout = async (headers: string[]) => {
    const layout = await table.evaluate((node) => {
      const table = node as HTMLTableElement;
      const headers = Array.from(table.tHead?.rows[0]?.cells ?? [], (cell) => cell.textContent?.trim());
      const rows = Array.from(table.tBodies[0]?.rows ?? []);
      return {
        headers,
        rows: rows.length,
        aligned: rows.every((row) => row.cells.length === headers.length),
        fitsViewport: document.documentElement.scrollWidth <= innerWidth,
      };
    });
    expect(layout).toEqual({ headers, rows: 28, aligned: true, fitsViewport: true });
  };
  await expect(rows).toHaveCount(28);
  await expectLayout(allColumns);

  const upload = table.getByRole("button", { name: "Upload", exact: true });
  await upload.press("Enter");
  await expect(upload.locator("..")).toHaveAttribute("aria-sort", "descending");
  await expect(rows.first().getByRole("button", { name: "Details for mock-28", exact: true })).toBeVisible();

  const trigger = page.getByRole("button", { name: "Columns", exact: true });
  const menu = page.getByRole("menu");
  const option = (name: string) => menu.getByRole("menuitemcheckbox", { name, exact: true });
  await trigger.press("Enter");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitemcheckbox")).toHaveCount(4);
  for (const name of ["Network", "Outbound", "Upload", "Download"]) {
    await expect(option(name)).toHaveAttribute("aria-checked", "true");
  }
  await option("Upload").press("Enter");
  await expect(option("Upload")).toHaveAttribute("aria-checked", "false");
  await expect(menu).toBeVisible();
  await expectLayout(allColumns.filter((name) => name !== "Upload"));
  await expect(table.locator('thead th[aria-sort="descending"]')).toHaveText("Start time");

  for (const name of ["Network", "Outbound", "Download"]) {
    await option(name).press("Enter");
    await expect(option(name)).toHaveAttribute("aria-checked", "false");
  }
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expectLayout(["Destination", "Status", "Start time", "Actions"]);
  const start = table.getByRole("button", { name: "Start time", exact: true });
  await expect(start.locator("..")).toHaveAttribute("aria-sort", "descending");
  await expect(rows.first().getByRole("button", { name: "Details for mock-1", exact: true })).toBeVisible();

  await page.keyboard.press("Enter");
  await menu.getByRole("menuitem", { name: "Reset columns", exact: true }).press("Enter");
  await expect(menu).toBeHidden();
  await expectLayout(allColumns);
});

test("shows and sorts exact close times only in Closed history", async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  const firstClose = new Date("2025-03-14T13:00:00.123Z");
  const secondClose = new Date(firstClose.getTime() + 1);
  await page.clock.setFixedTime(new Date(firstClose.getTime() - 5000));
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await page.getByRole("link", { name: "Connections", exact: true }).first().click();

  const table = page.locator(".connection-table");
  const details = (id: string) => page.getByRole("button", { name: `Details for ${id}`, exact: true });
  const comparedRows = table.locator("tbody tr").filter({
    has: page.getByRole("button", { name: /^Details for mock-[12]$/ }),
  });
  const expectOrder = async (ids: string[]) => {
    await expect(comparedRows).toHaveCount(ids.length);
    for (const [index, id] of ids.entries()) {
      await expect(comparedRows.nth(index).getByRole("button", { name: `Details for ${id}`, exact: true })).toBeVisible();
    }
  };
  const expectSort = (label: string, direction = "descending") =>
    expect(table.locator(`thead th[aria-sort="${direction}"]`)).toHaveText(label);
  const closedAt = table.getByRole("button", { name: "Closed at", exact: true });
  const columns = page.getByRole("button", { name: "Columns", exact: true });
  const menu = page.getByRole("menu");
  const closedOption = menu.getByRole("menuitemcheckbox", { name: "Closed at", exact: true });
  const chooseStatus = async (name: string) => {
    await page.getByRole("combobox", { name: "Status filter", exact: true }).click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  const closeMenu = async () => {
    await page.keyboard.press("Escape");
    await expect(columns).toBeFocused();
  };
  const toggleClosedColumn = async () => {
    await columns.press("Enter");
    await closedOption.press("Enter");
    await closeMenu();
  };
  const resetColumns = async () => {
    await columns.press("Enter");
    await menu.getByRole("menuitem", { name: "Reset columns", exact: true }).press("Enter");
  };

  await expectOrder(["mock-1", "mock-2"]);
  await columns.press("Enter");
  await expect(menu).toBeVisible();
  await expect(closedOption).toHaveCount(0);
  await closeMenu();
  for (const [id, time] of [["mock-1", firstClose], ["mock-2", secondClose]] as const) {
    await page.clock.setFixedTime(time);
    await page.getByRole("button", { name: `Close ${id}`, exact: true }).click();
    await expect(details(id)).toHaveCount(0);
  }

  await chooseStatus("Closed");
  await expectSort("Start time");
  await expectOrder(["mock-1", "mock-2"]);
  await expect(closedAt).toHaveCount(0);
  await columns.press("Enter");
  await expect(closedOption).toHaveAttribute("aria-checked", "false");
  await closedOption.press("Enter");
  await expect(closedOption).toHaveAttribute("aria-checked", "true");
  await closeMenu();
  const closeColumnIndex = await closedAt.locator("..").evaluate((cell: HTMLTableCellElement) => cell.cellIndex);
  for (const [id, time] of [["mock-1", firstClose], ["mock-2", secondClose]] as const) {
    const cell = comparedRows.filter({ has: details(id) }).locator("td").nth(closeColumnIndex);
    await expect(cell.locator("time")).toHaveAttribute("datetime", time.toISOString());
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    (await page.viewportSize())!.width,
  );

  await closedAt.press("Enter");
  await expectSort("Closed at");
  await expectOrder(["mock-2", "mock-1"]);
  await closedAt.press("Enter");
  await expectSort("Closed at", "ascending");
  await expectOrder(["mock-1", "mock-2"]);

  await toggleClosedColumn();
  await expect(closedAt).toHaveCount(0);
  await expectSort("Start time");
  await toggleClosedColumn();
  await closedAt.press("Enter");
  await resetColumns();
  await expect(closedAt).toHaveCount(0);
  await expectSort("Start time");

  await toggleClosedColumn();
  await table.getByRole("button", { name: "Upload", exact: true }).press("Enter");
  await resetColumns();
  await expect(closedAt).toHaveCount(0);
  await expectSort("Upload");

  await toggleClosedColumn();
  await closedAt.press("Enter");
  await chooseStatus("All statuses");
  await expect(closedAt).toHaveCount(0);
  await expectSort("Start time");
  await columns.press("Enter");
  await expect(menu).toBeVisible();
  await expect(closedOption).toHaveCount(0);
  await closeMenu();
  await chooseStatus("Closed");
  await expect(closedAt).toBeVisible();
  await expectSort("Start time");
});
