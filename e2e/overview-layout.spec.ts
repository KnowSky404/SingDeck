import { expect, test, type Locator, type Page } from "@playwright/test";

const storageKey = "singdeck.display-preferences";
const legacyLayoutKey = "singdeck.overview-layout";
const defaultMetrics = ["Download", "Upload", "Active connections", "Memory"];
const defaultPanels = ["Traffic activity", "Instance details", "Outbound groups", "Recent logs"];
const customMetrics = ["Upload", "Download", "Active connections", "Memory"];
const customPanels = ["Recent logs", "Traffic activity", "Instance details", "Outbound groups"];
const customOrder = {
  metrics: ["upload", "download", "connections", "memory"],
  panels: ["logs", "traffic", "instance", "outbounds"],
};

async function startDemo(page: Page) {
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page.getByText("Mock mode", { exact: true })).toBeVisible();
}

async function expectCardOrder(page: Page, metrics: string[], panels: string[]) {
  for (const [group, order] of [[".metrics-grid", metrics], [".overview-grid", panels]] as const) {
    const cards = page.locator(`#main-content ${group} > [data-slot="card"]`);
    await expect.poll(() => cards.evaluateAll(nodes => {
      const items = nodes.map(node => {
        const { left, top } = node.getBoundingClientRect();
        const title = node.querySelector('[data-slot="card-title"]')?.textContent?.trim();
        return { title, left, top };
      });
      const dom = items.map(item => item.title);
      const visual = items.sort((a, b) => Math.abs(a.top - b.top) < 1 ? a.left - b.left : a.top - b.top)
        .map(item => item.title);
      return { dom, visual };
    })).toEqual({ dom: order, visual: order });
  }
}

function activate(locator: Locator, isMobile: boolean) {
  return isMobile ? locator.tap() : locator.press("Enter");
}

function layoutControls(page: Page) {
  const trigger = page.getByRole("button", { name: "Customize Overview", exact: true });
  const dialog = page.getByRole("dialog", { name: "Customize Overview", exact: true });
  const moveUp = (title: string) => dialog.getByRole("button", { name: `Move ${title} up`, exact: true });
  const moveDown = (title: string) => dialog.getByRole("button", { name: `Move ${title} down`, exact: true });
  const reset = dialog.getByRole("button", { name: "Reset layout", exact: true });
  return { trigger, dialog, moveUp, moveDown, reset };
}

test("Overview rearranges real cards, retains its active chart window and restores saved order", async ({ page, isMobile }) => {
  await page.setViewportSize(isMobile ? { width: 320, height: 740 } : { width: 1280, height: 800 });
  await page.goto("/");
  await startDemo(page);
  await expectCardOrder(page, defaultMetrics, defaultPanels);
  const storedOrder = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null")?.overviewLayout ?? null, storageKey);
  expect(await storedOrder()).toBeNull();

  const history = page.getByRole("combobox", { name: "History window", exact: true });
  const chart = page.getByRole("img", { name: /^Traffic history\./ });
  const curves = chart.locator("path.recharts-area-curve");
  await activate(history, isMobile);
  const threeMinutes = page.getByRole("option", { name: "3 minutes", exact: true });
  if (isMobile) await threeMinutes.tap();
  else {
    await page.keyboard.press("ArrowDown");
    await expect(threeMinutes).toBeFocused();
    await page.keyboard.press("Enter");
  }
  await expect(history).toHaveText("3 minutes");
  await expect(curves).toHaveCount(2);
  const initialChartWidth = await chart.evaluate(node => node.getBoundingClientRect().width);

  const { trigger, dialog, moveUp, moveDown, reset } = layoutControls(page);
  await activate(trigger, isMobile);
  await expect(dialog.getByRole("list", { name: "Metric cards" }).getByRole("listitem")).toHaveCount(4);
  await expect(dialog.getByRole("list", { name: "Detail panels" }).getByRole("listitem")).toHaveCount(4);
  const uploadUp = moveUp("Upload");
  await activate(uploadUp, isMobile);
  await expect(uploadUp).toBeDisabled();
  await expect(dialog.getByRole("status")).toHaveText("Moved Upload to position 1 of 4.");
  if (!isMobile) {
    await expect(uploadUp).toBeFocused();
    await page.keyboard.press("Enter");
  }
  await expectCardOrder(page, customMetrics, defaultPanels);

  const logsUp = moveUp("Recent logs");
  const logsDown = moveDown("Recent logs");
  await expect(logsDown).toBeDisabled();
  for (const position of [3, 2, 1]) {
    await activate(logsUp, isMobile);
    await expect(dialog.getByRole("status")).toHaveText(`Moved Recent logs to position ${position} of 4.`);
    if (!isMobile) await expect(logsUp).toBeFocused();
  }
  await expect(logsUp).toBeDisabled();
  await expectCardOrder(page, customMetrics, customPanels);
  await activate(logsDown, isMobile);
  await expect(dialog.getByRole("status")).toHaveText("Moved Recent logs to position 2 of 4.");
  await expectCardOrder(page, customMetrics, ["Traffic activity", "Recent logs", "Instance details", "Outbound groups"]);
  await activate(logsUp, isMobile);
  await expectCardOrder(page, customMetrics, customPanels);
  await expect.poll(storedOrder).toEqual(customOrder);

  if (isMobile) await dialog.getByRole("button", { name: "Close", exact: true }).tap();
  else await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  if (!isMobile) {
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "View logs", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(history).toBeFocused();
    await expect.poll(() => chart.evaluate(node => node.getBoundingClientRect().width)).toBeLessThan(initialChartWidth);
  }
  await expect(history).toHaveText("3 minutes");
  await expect(curves).toHaveCount(2);
  await history.scrollIntoViewIfNeeded();
  await expect(history).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.getByRole("link", { name: "Connections", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Overview", exact: true }).first().click();
  await expectCardOrder(page, customMetrics, customPanels);
  await page.reload();
  await startDemo(page);
  await expectCardOrder(page, customMetrics, customPanels);

  await activate(trigger, isMobile);
  await activate(reset, isMobile);
  await expect(dialog.getByRole("status")).toHaveText("Default layout restored.");
  if (!isMobile) await expect(reset).toBeFocused();
  await expectCardOrder(page, defaultMetrics, defaultPanels);
  await expect.poll(storedOrder).toEqual({
    metrics: ["download", "upload", "connections", "memory"],
    panels: ["traffic", "instance", "outbounds", "logs"],
  });
});

test("Overview can customize and reset in a short viewport when layout storage is unavailable", async ({ page, isMobile }) => {
  await page.setViewportSize({ width: isMobile ? 320 : 420, height: 250 });
  await page.addInitScript(({ key, legacyKey }) => {
    if (location.search === "?layout=corrupt") localStorage.setItem(legacyKey, "{");
    if (location.search === "?layout=blocked") {
      const { getItem, setItem } = Storage.prototype;
      Storage.prototype.getItem = function (name) {
        if (this === localStorage && name === key) throw new DOMException("Fixture storage unavailable", "SecurityError");
        return getItem.call(this, name);
      };
      Storage.prototype.setItem = function (name, value) {
        if (this === localStorage && name === key) throw new DOMException("Fixture storage unavailable", "SecurityError");
        setItem.call(this, name, value);
      };
    }
  }, { key: storageKey, legacyKey: legacyLayoutKey });

  await page.goto("/?layout=corrupt");
  await startDemo(page);
  await expectCardOrder(page, defaultMetrics, defaultPanels);
  expect(await page.evaluate(key => localStorage.getItem(key), legacyLayoutKey)).toBe("{");

  await page.goto("/?layout=blocked");
  await startDemo(page);
  await expectCardOrder(page, defaultMetrics, defaultPanels);
  const { trigger, dialog, moveUp, reset } = layoutControls(page);
  await activate(trigger, isMobile);
  await expect(dialog).toBeInViewport({ ratio: 1 });
  await activate(moveUp("Upload"), isMobile);
  await expectCardOrder(page, customMetrics, defaultPanels);

  const logsUp = moveUp("Recent logs");
  if (isMobile) {
    const scroller = dialog.locator(".overflow-y-auto");
    const { x, y, height } = (await scroller.boundingBox())!;
    const touch = await page.context().newCDPSession(page);
    const inScroller = () => logsUp.evaluate(node => {
      const { top, bottom } = node.getBoundingClientRect();
      const bounds = node.closest(".overflow-y-auto")!.getBoundingClientRect();
      return top >= bounds.top && bottom <= bounds.bottom;
    });
    for (let swipe = 0; swipe < 12 && !(await inScroller()); swipe++) {
      const start = y + height - 5;
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x + 12, y: start }] });
      for (let step = 1; step <= 5; step++) {
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove", touchPoints: [{ x: x + 12, y: start - (height - 10) * step / 5 }],
        });
      }
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
  } else {
    // From the first row's up button to the eighth row's up button.
    for (let index = 0; index < 14; index++) await page.keyboard.press("Tab");
    await expect(logsUp).toBeFocused();
  }
  await expect(logsUp).toBeInViewport({ ratio: 1 });
  await activate(logsUp, isMobile);
  await expectCardOrder(page, customMetrics, ["Traffic activity", "Instance details", "Recent logs", "Outbound groups"]);
  await expect(reset).toBeInViewport({ ratio: 1 });
  await activate(reset, isMobile);
  await expect(dialog.getByRole("status")).toHaveText("Default layout restored.");
  await expectCardOrder(page, defaultMetrics, defaultPanels);
});
