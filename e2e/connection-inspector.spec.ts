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
  await expect(fact("Closed at")).toHaveText("Unavailable");
  await expect(fact("Download total")).toHaveText(/^[\d.]+ [KMGT]?B$/);

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
  await expect(fact("Download total")).toHaveText(/^[\d.]+ [KMGT]?B$/);
});
