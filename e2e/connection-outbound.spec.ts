import { expect, test, type Page } from "@playwright/test";
import { ServiceStatus_Type } from "../src/proto/daemon/started_service_pb";

const tag = "Singapore 01";
const unavailable = "The reported outbound is unavailable.";
const demoLifecycleEvent = "reported-outbound-test-lifecycle";

async function provideDemoInventory(
  page: Page,
  mode: "exact" | "lowercase-only" | "duplicate",
  sourceTags?: Record<string, string>,
) {
  const path = "/src/mocks/client.ts";
  const original = "reported-outbound-original";
  // Playwright uses the Vite dev server. The explicit Demo connection keeps its normal mock lifecycle.
  await page.route(
    (url) => url.pathname === path && !url.searchParams.has(original),
    (route) => route.fulfill({
      contentType: "application/javascript",
      body: `
        import { createMockClient as original, MockControl } from ${JSON.stringify(`${path}?${original}`)};
        let serviceStatus;
        window.addEventListener(${JSON.stringify(demoLifecycleEvent)}, (event) => { serviceStatus = event.detail; });
        export { MockControl };
        export function createMockClient(control) {
          const client = original(control);
          return {
            ...client,
            async *subscribeServiceStatus(request, options) {
              for await (const frame of client.subscribeServiceStatus(request, options)) {
                yield serviceStatus === undefined ? frame : { ...frame, status: serviceStatus };
              }
            },
            ${sourceTags ? `async *subscribeConnections(request, options) {
              const tags = ${JSON.stringify(sourceTags)};
              for await (const frame of client.subscribeConnections(request, options)) {
                yield { ...frame, events: frame.events.map((event) => {
                  const outbound = tags[event.id];
                  return outbound && event.connection
                    ? { ...event, connection: { ...event.connection, outbound } }
                    : event;
                }) };
              }
            },` : ""}
            async *subscribeOutbounds(request, options) {
              for await (const frame of client.subscribeOutbounds(request, options)) {
                const outbounds = frame.outbounds.flatMap((entry) => {
                  if (entry.tag !== ${JSON.stringify(tag)}) return [entry];
                  const mode = ${JSON.stringify(mode)};
                  if (mode === "duplicate") return [entry, { ...entry, type: "direct" }];
                  const lowercase = { ...entry, tag: entry.tag.toLowerCase() };
                  return mode === "exact" ? [entry, lowercase] : [lowercase];
                });
                yield { ...frame, outbounds };
              }
            },
          };
        }
      `,
    }),
  );
}

test("withholds the outbound action for unsafe labels on live connections", async ({ page }) => {
  const sourceTags = {
    "mock-1": "token%3A%20placeholder",
    "mock-2": "Sing\u200Bapore 01",
    "mock-3": "[redacted]",
    "mock-4": "edge %5Bredacted%5D",
  };
  await provideDemoInventory(page, "exact", sourceTags);
  await page.goto("/");
  await connectDemo(page);
  await page.getByRole("link", { name: "Connections", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Connection details", exact: true });
  for (const [id, tag] of Object.entries(sourceTags)) {
    await expect(page.getByRole("button", { name: `Close ${id}`, exact: true })).toBeEnabled();
    await page.getByRole("button", { name: `Details for ${id}`, exact: true }).click();
    await expect(dialog.getByText(tag, { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "View reported outbound", exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(/#\/connections$/);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
});

async function connectDemo(page: Page) {
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page.getByText("Mock mode", { exact: true })).toBeVisible();
}

async function openReportedOutbound(page: Page) {
  await page.getByRole("link", { name: "Connections", exact: true }).first().click();
  await page.getByRole("button", { name: "Details for mock-1", exact: true }).press("Enter");
  const dialog = page.getByRole("dialog", { name: "Connection details", exact: true });
  await dialog.getByRole("button", { name: "View reported outbound", exact: true }).press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL((url) => url.pathname === "/" && !url.search && url.hash === "#/proxies");
  await expect(page.getByRole("radio", { name: "All outbounds", exact: true })).toBeChecked();
  const region = page.getByRole("region", { name: "Reported outbound", exact: true });
  await expect(region.getByRole("heading", { name: "Reported outbound", level: 2 })).toBeFocused();
  return region;
}

async function expectPrivateScope(page: Page) {
  expect(await page.evaluate((value) => [
    JSON.stringify(history.state),
    JSON.stringify(localStorage),
    JSON.stringify(sessionStorage),
    ...Array.from(document.querySelectorAll<HTMLInputElement>("input"), (input) => input.value),
  ].some((field) => field.includes(value)), tag)).toBe(false);
}

test("returns keyboard focus when a topology change retires the reported outbound", async ({ page }) => {
  await provideDemoInventory(page, "exact");
  await page.goto("/");
  await connectDemo(page);

  const setServiceStatus = (status: ServiceStatus_Type) => page.evaluate(({ event, status }) => {
    window.dispatchEvent(new CustomEvent(event, { detail: status }));
  }, { event: demoLifecycleEvent, status });
  const search = page.getByRole("textbox", { name: "Search outbounds", exact: true });
  const all = page.getByRole("radio", { name: "All outbounds", exact: true });
  const list = page.getByRole("list", { name: "All outbounds", exact: true });

  for (const focusInside of [true, false]) {
    const region = await openReportedOutbound(page);
    await expect(region.getByRole("listitem").getByText(tag, { exact: true })).toBeVisible();
    if (!focusInside) {
      await all.focus();
      await expect(all).toBeFocused();
    }
    await setServiceStatus(ServiceStatus_Type.IDLE);
    await expect(region).toHaveCount(0);
    await expect(search).toHaveValue("");
    await expect(focusInside ? search : all).toBeFocused();

    await setServiceStatus(ServiceStatus_Type.STARTED);
    await expect(list.getByText(tag.toLowerCase(), { exact: true })).toBeVisible();
    await expect(region).toHaveCount(0);
  }
});

test("shows one exact reported outbound and retires the scope from ordinary views", async ({ page }) => {
  test.setTimeout(45_000);
  await provideDemoInventory(page, "exact");
  await page.goto("/");
  await connectDemo(page);

  const region = await openReportedOutbound(page);
  const rows = region.getByRole("listitem");
  await expect(rows).toHaveCount(1);
  await expect(rows.getByText(tag, { exact: true })).toBeVisible();
  await expect(region.getByText(tag.toLowerCase(), { exact: true })).toHaveCount(0);
  await expectPrivateScope(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const search = page.getByRole("textbox", { name: "Search outbounds", exact: true });
  const all = page.getByRole("radio", { name: "All outbounds", exact: true });
  const list = page.getByRole("list", { name: "All outbounds", exact: true });
  await region.getByRole("button", { name: "Show all outbounds", exact: true }).click();
  await expect(region).toHaveCount(0);
  await expect(all).toBeChecked();
  await expect(search).toBeVisible();
  await expect(search).toHaveValue("");
  await expect(list.getByText(tag.toLowerCase(), { exact: true })).toBeVisible();

  await openReportedOutbound(page);
  const groups = page.getByRole("radio", { name: "Groups", exact: true });
  await groups.click();
  await expect(groups).toBeChecked();
  await expect(region).toHaveCount(0);
  await all.click();
  await expect(search).toBeVisible();

  await openReportedOutbound(page);
  await page.getByRole("link", { name: "Logs", exact: true }).first().click();
  await expect(page).toHaveURL(/#\/logs$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Outbounds", exact: true })).toBeVisible();
  await expect(region).toHaveCount(0);

  await openReportedOutbound(page);
  await page.getByRole("button", { name: "Current connection", exact: true }).click();
  await page.getByRole("menuitem", { name: "Disconnect", exact: true }).click();
  await connectDemo(page);
  await page.getByRole("link", { name: "Outbounds", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Outbounds", exact: true })).toBeVisible();
  await expect(region).toHaveCount(0);

  await page.getByRole("link", { name: "Connections", exact: true }).first().click();
  await page.getByRole("combobox", { name: "Status filter", exact: true }).click();
  await page.getByRole("option", { name: "Closed", exact: true }).click();
  await page.getByRole("button", { name: "Details for mock-closed-1", exact: true }).click();
  const closed = page.getByRole("dialog", { name: "Connection details", exact: true });
  await expect(closed.getByRole("button", { name: "View reported outbound", exact: true })).toHaveCount(0);
});

for (const mode of ["lowercase-only", "duplicate"] as const) {
  test(`gives the neutral result for ${mode} reported outbound matches`, async ({ page }) => {
    await provideDemoInventory(page, mode);
    await page.goto("/");
    await connectDemo(page);

    const region = await openReportedOutbound(page);
    await expect(region.getByText(unavailable, { exact: true })).toBeVisible();
    await expect(region.getByRole("listitem")).toHaveCount(0);
    await expectPrivateScope(page);
  });
}
