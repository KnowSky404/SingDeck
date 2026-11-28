import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";

const preferenceKey = "singdeck.display-preferences";
const filename = "singdeck-display-preferences.json";
const fixtureRevision = "0123456789abcdef0123456789abcdef";
const legacy = {
  format: "singdeck-display-preferences",
  version: 1,
  theme: "light",
  language: "en",
  overviewLayout: {
    metrics: ["download", "connections", "upload", "memory"],
    panels: ["outbounds", "traffic", "instance", "logs"],
  },
};
const imported = {
  ...legacy,
  theme: "dark",
  language: "zh",
  overviewLayout: {
    metrics: ["memory", "upload", "connections", "download"],
    panels: ["logs", "instance", "outbounds", "traffic"],
  },
};
const fixtureBaseline = JSON.stringify({ revision: fixtureRevision, document: legacy });

function activate(button: Locator, isMobile: boolean) {
  return isMobile ? button.tap() : button.press("Enter");
}

async function expectLayoutReview(dialog: Locator, isMobile: boolean) {
  await expect(dialog.getByText("Overview layout changed. Review it and continue editing.", { exact: true })).toBeVisible();
  const continueEditing = dialog.getByRole("button", { name: "Continue editing", exact: true });
  await expect(continueEditing).toBeEnabled();
  await expect(continueEditing).toBeFocused();
  await expect(dialog.getByRole("button", { name: /^(Move |Reset layout$)/, disabled: false })).toHaveCount(0);
  if (isMobile) await expect(continueEditing).toBeInViewport({ ratio: 1 });
  return continueEditing;
}

async function acknowledgeLayoutReview(continueEditing: Locator, action: Locator, isMobile: boolean) {
  await activate(continueEditing, isMobile);
  await expect(continueEditing).toBeHidden();
  await expect(action).toBeEnabled();
  await expect(action).toBeFocused();
  if (isMobile) await expect(action).toBeInViewport({ ratio: 1 });
}

async function demo(page: Page, language: "en" | "zh") {
  const label = language === "zh" ? "体验演示" : "Explore demo";
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(page.locator(".connection-status")).toHaveText(language === "zh" ? "已连接" : "Connected");
}

async function navigate(page: Page, name: string, isMobile: boolean) {
  if (name === "Settings" && isMobile) await page.getByRole("button", { name: "Open navigation", exact: true }).tap();
  await page.getByRole("link", { name, exact: true }).first().click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

async function expectDisplay(page: Page, language: "en" | "zh", theme: "light" | "dark") {
  const html = page.locator("html");
  await expect(html).toHaveAttribute("lang", language === "zh" ? "zh-CN" : "en");
  await expect(html).toHaveCSS("color-scheme", theme);
}

async function expectOverview(page: Page, metrics: string[], panels: string[]) {
  const titles = (group: string) => page.locator(`#main-content ${group} > [data-slot="card"] [data-slot="card-title"]`);
  await expect(titles(".metrics-grid")).toHaveText(metrics);
  await expect(titles(".overview-grid")).toHaveText(panels);
}

const legacyMetrics = ["Download", "Active connections", "Upload", "Memory"];
const legacyPanels = ["Outbound groups", "Traffic activity", "Instance details", "Recent logs"];
const importedMetrics = ["内存", "上传", "活动连接", "下载"];
const importedPanels = ["最近日志", "实例信息", "代理组", "流量趋势"];

async function downloadPreferences(page: Page, button: Locator, isMobile: boolean) {
  const downloading = page.waitForEvent("download");
  await activate(button, isMobile);
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(filename);
  return JSON.parse(await readFile(await download.path(), "utf8"));
}

async function chooseFile(page: Page, isMobile: boolean, json: unknown, name = filename) {
  const choosing = page.waitForEvent("filechooser");
  await activate(page.getByRole("button", { name: "Import display preferences", exact: true }), isMobile);
  const chooser = await choosing;
  await chooser.setFiles({ name, mimeType: "", buffer: Buffer.from(JSON.stringify(json)) });
}

const stored = (page: Page) => page.evaluate(key => localStorage.getItem(key), preferenceKey);

const effectiveStored = (page: Page) => page.evaluate(key => {
  const { revision, document } = JSON.parse(localStorage.getItem(key)!);
  const getField = (field: string) => localStorage.getItem(`${key}.${revision}.${field}`);
  const layout = getField("overviewLayout");
  return {
    ...document,
    theme: getField("theme") ?? document.theme,
    language: getField("language") ?? document.language,
    overviewLayout: layout !== null ? JSON.parse(layout) : document.overviewLayout,
  };
}, preferenceKey);

test("Settings exports legacy-backed display preferences and imports a whole persistent snapshot", async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  await page.addInitScript((layout) => {
    if (!localStorage.getItem("singdeck.theme")) localStorage.setItem("singdeck.theme", "light");
    if (!localStorage.getItem("singdeck.language")) localStorage.setItem("singdeck.language", "en");
    if (!localStorage.getItem("singdeck.overview-layout")) localStorage.setItem("singdeck.overview-layout", JSON.stringify(layout));
  }, legacy.overviewLayout);
  await page.goto("/");
  await demo(page, "en");
  await expectDisplay(page, "en", "light");
  await expectOverview(page, legacyMetrics, legacyPanels);
  await navigate(page, "Settings", isMobile);
  await expect(page.getByText("Display preferences", { exact: true })).toBeVisible();
  const exportButton = page.getByRole("button", { name: "Export display preferences", exact: true });
  expect(await downloadPreferences(page, exportButton, isMobile)).toEqual(legacy);
  expect(await stored(page)).toBeNull();

  const connection = await page.locator(".connection-status").evaluateHandle(node => {
    const phases = new Set([node.textContent?.trim()]);
    const observer = new MutationObserver(() => phases.add(node.textContent?.trim()));
    observer.observe(node, { childList: true, subtree: true, characterData: true });
    return { node, phases, observer };
  });
  await chooseFile(page, isMobile, imported);
  await expectDisplay(page, "zh", "dark");
  await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
  await expect(page.getByText("已导入显示偏好。", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.locator(".connection-status")).toHaveText("已连接");
  expect(await connection.evaluate(({ node, phases, observer }) => {
    observer.disconnect();
    return { mounted: node.isConnected, phases: [...phases] };
  })).toEqual({ mounted: true, phases: ["Connected", "已连接"] });
  await connection.dispose();
  expect(JSON.parse((await stored(page))!)).toEqual({
    revision: expect.stringMatching(/^[0-9a-f]{32}$/),
    document: imported,
  });
  expect(await page.evaluate(() => ({
    theme: localStorage.getItem("singdeck.theme"),
    language: localStorage.getItem("singdeck.language"),
    overviewLayout: JSON.parse(localStorage.getItem("singdeck.overview-layout")!),
  }))).toEqual({ theme: legacy.theme, language: legacy.language, overviewLayout: legacy.overviewLayout });

  await navigate(page, "概览", isMobile);
  await expectOverview(page, importedMetrics, importedPanels);
  await page.reload();
  await expectDisplay(page, "zh", "dark");
  await demo(page, "zh");
  await expectOverview(page, importedMetrics, importedPanels);
});

test("Settings rejects mixed invalid input and can export a same-name retry that could not be saved", async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  await page.addInitScript(({ key, initial }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, initial);
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (this === localStorage && name === key) throw new DOMException("Fixture storage unavailable", "QuotaExceededError");
      write.call(this, name, value);
    };
  }, { key: preferenceKey, initial: fixtureBaseline });
  await page.goto("/");
  await demo(page, "en");
  await navigate(page, "Settings", isMobile);
  const invalid = { ...imported, overviewLayout: { ...imported.overviewLayout, panels: ["logs", "instance", "outbounds", "logs"] } };
  await chooseFile(page, isMobile, invalid);
  await expect(page.getByText("This file is not a supported display preferences file.", { exact: true })).toBeVisible();
  await expectDisplay(page, "en", "light");
  await expect(page.locator('input[type="file"]')).toHaveValue("");
  const exportButton = page.getByRole("button", { name: "Export display preferences", exact: true });
  expect(await downloadPreferences(page, exportButton, isMobile)).toEqual(legacy);
  expect(await stored(page)).toBe(fixtureBaseline);

  await chooseFile(page, isMobile, imported);
  await expectDisplay(page, "zh", "dark");
  await expect(page.getByText("已在本次访问中应用显示偏好。浏览器存储不可用。", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/settings$/);
  const translatedExport = page.getByRole("button", { name: "导出显示偏好", exact: true });
  expect(await downloadPreferences(page, translatedExport, isMobile)).toEqual(imported);
  expect(await stored(page)).toBe(fixtureBaseline);
  expect(await page.evaluate(() => ["singdeck.theme", "singdeck.language", "singdeck.overview-layout"].map(key => localStorage.getItem(key))))
    .toEqual([null, null, null]);
  await navigate(page, "概览", isMobile);
  await expectOverview(page, importedMetrics, importedPanels);
  await expectDisplay(page, "zh", "dark");
  expect(await stored(page)).toBe(fixtureBaseline);
  expect(await effectiveStored(page)).toEqual(legacy);

  await page.reload();
  await expectDisplay(page, "en", "light");
  await demo(page, "en");
  await expectOverview(page, legacyMetrics, legacyPanels);
});

test("Settings abandons a delayed preference read when replaced or when leaving the route", async ({ page, isMobile }) => {
  test.skip(isMobile, "The asynchronous read guards are shared across viewports.");
  await page.addInitScript((stale) => {
    const read = File.prototype.text;
    File.prototype.text = function () {
      if (!this.name.startsWith("pending-")) return read.call(this);
      return new Promise(resolve => {
        document.addEventListener(this.name, () => resolve(stale), { once: true });
      });
    };
  }, JSON.stringify(imported));
  const finishRead = (name: string) => page.evaluate(async eventName => {
    document.dispatchEvent(new Event(eventName));
    await new Promise(requestAnimationFrame);
  }, name);
  await page.goto("/");
  await demo(page, "en");
  await navigate(page, "Settings", false);
  await chooseFile(page, false, imported, "pending-first.json");
  await expect(page.getByText("Reading display preferences…", { exact: true })).toBeVisible();
  await chooseFile(page, false, legacy);
  const importedFeedback = page.getByText("Display preferences imported.", { exact: true });
  await expect(importedFeedback).toBeVisible();
  await finishRead("pending-first.json");
  await expect(importedFeedback).toBeVisible();
  await expectDisplay(page, "en", "light");
  const acceptedBaseline = await stored(page);
  expect(await effectiveStored(page)).toEqual(legacy);

  await chooseFile(page, false, imported, "pending-exit.json");
  await expect(page.getByText("Reading display preferences…", { exact: true })).toBeVisible();
  await navigate(page, "Overview", false);
  await finishRead("pending-exit.json");
  await expectDisplay(page, "en", "light");
  await expectOverview(page, legacyMetrics, legacyPanels);
  expect(await stored(page)).toBe(acceptedBaseline);
  expect(await effectiveStored(page)).toEqual(legacy);
});

test("Overview restores another tab's panel order before saving a metric move", async ({ context, page, isMobile }) => {
  test.skip(isMobile, "The cross-tab storage behavior is shared across viewports.");
  await context.addInitScript(({ key, initial }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, initial);
  }, { key: preferenceKey, initial: fixtureBaseline });
  await page.goto("/");
  await demo(page, "en");
  await expectOverview(page, legacyMetrics, legacyPanels);

  const other = await context.newPage();
  await other.goto("/");
  await demo(other, "en");
  await navigate(other, "Settings", false);

  const customize = async (tab: Page) => {
    await tab.getByRole("button", { name: "Customize Overview", exact: true }).press("Enter");
    return tab.getByRole("dialog", { name: "Customize Overview", exact: true });
  };
  await (await customize(page)).getByRole("button", { name: "Move Recent logs up", exact: true }).press("Enter");
  const panels = ["outbounds", "traffic", "logs", "instance"];
  const panelTitles = ["Outbound groups", "Traffic activity", "Recent logs", "Instance details"];
  const readPersisted = () => effectiveStored(page);
  await expect.poll(readPersisted).toEqual({ ...legacy, overviewLayout: { ...legacy.overviewLayout, panels } });

  await navigate(other, "Overview", false);
  await expectOverview(other, legacyMetrics, panelTitles);
  await (await customize(other)).getByRole("button", { name: "Move Upload up", exact: true }).press("Enter");
  await other.keyboard.press("Escape");
  await expectOverview(other, ["Download", "Upload", "Active connections", "Memory"], panelTitles);
  await expect.poll(readPersisted).toEqual({
    ...legacy,
    overviewLayout: { metrics: ["download", "upload", "connections", "memory"], panels },
  });
  expect(await stored(page)).toBe(fixtureBaseline);
});

test("Overview keeps an imported layout when another tab acts on an older open dialog", async ({ context, page, isMobile }) => {
  await context.addInitScript(({ key, initial }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, initial);
  }, { key: preferenceKey, initial: fixtureBaseline });
  const other = await context.newPage();
  if (isMobile) {
    await page.setViewportSize({ width: 320, height: 210 });
    await other.setViewportSize({ width: 320, height: 740 });
  }

  await page.goto("/");
  await demo(page, "en");
  await activate(page.getByRole("button", { name: "Customize Overview", exact: true }), isMobile);
  const dialog = page.getByRole("dialog", { name: "Customize Overview", exact: true });
  const metricRows = dialog.getByRole("list", { name: "Metric cards", exact: true }).getByRole("listitem");
  const panelRows = dialog.getByRole("list", { name: "Detail panels", exact: true }).getByRole("listitem");
  const uploadUp = dialog.getByRole("button", { name: "Move Upload up", exact: true });
  await expect(metricRows).toHaveText(legacyMetrics);
  await expect(panelRows).toHaveText(legacyPanels);

  await other.goto("/");
  await demo(other, "en");
  await navigate(other, "Settings", isMobile);
  await chooseFile(other, isMobile, imported);
  await expect(other.getByText("已导入显示偏好。", { exact: true })).toBeVisible();
  await expectDisplay(other, "zh", "dark");
  const importedSnapshot = await stored(other);
  expect(importedSnapshot).not.toBe(fixtureBaseline);
  const { revision } = JSON.parse(importedSnapshot!);
  const layoutOverride = () => page.evaluate(key => localStorage.getItem(key), `${preferenceKey}.${revision}.overviewLayout`);

  await page.bringToFront();
  await expect(metricRows).toHaveText(legacyMetrics);
  await expect(panelRows).toHaveText(legacyPanels);
  await activate(uploadUp, isMobile);
  const continueEditing = await expectLayoutReview(dialog, isMobile);
  await expect(metricRows).toHaveText(["Memory", "Upload", "Active connections", "Download"]);
  const panelTitles = ["Recent logs", "Instance details", "Outbound groups", "Traffic activity"];
  await expect(panelRows).toHaveText(panelTitles);
  await expect(uploadUp).toBeDisabled();
  expect(await stored(page)).toBe(importedSnapshot);
  expect(await layoutOverride()).toBeNull();
  expect(await effectiveStored(page)).toEqual(imported);

  await acknowledgeLayoutReview(continueEditing, uploadUp, isMobile);
  expect(await stored(page)).toBe(importedSnapshot);
  expect(await layoutOverride()).toBeNull();
  expect(await effectiveStored(page)).toEqual(imported);

  await activate(uploadUp, isMobile);
  await expect(dialog.getByRole("status")).toHaveText("Moved Upload to position 1 of 4.");
  await expect(metricRows).toHaveText(["Upload", "Memory", "Active connections", "Download"]);
  await expect(panelRows).toHaveText(panelTitles);
  await expect.poll(() => effectiveStored(page)).toEqual({
    ...imported,
    overviewLayout: { ...imported.overviewLayout, metrics: ["upload", "memory", "connections", "download"] },
  });
  expect(await stored(page)).toBe(importedSnapshot);

  await other.reload();
  await expectDisplay(other, "zh", "dark");
  await demo(other, "zh");
  await expectOverview(other, ["上传", "内存", "活动连接", "下载"], importedPanels);
});

for (const input of ["keyboard", "pointer"] as const) {
  test(`Overview requires acknowledgement before resetting after a stale ${input} action`, async ({ context, page, isMobile }) => {
    test.skip(isMobile && input === "keyboard", "This case exercises native keyboard repeat.");
    await context.addInitScript(({ key, initial }) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, initial);
    }, { key: preferenceKey, initial: fixtureBaseline });
    if (isMobile) await page.setViewportSize({ width: 320, height: 210 });
    else if (input === "keyboard") await page.setViewportSize({ width: 1280, height: 480 });
    await page.goto("/");
    if (isMobile) {
      await page.addStyleTag({ content: '[data-slot="dialog-content"] button { font-size: 24px !important; }' });
    }
    await demo(page, "en");
    await activate(page.getByRole("button", { name: "Customize Overview", exact: true }), isMobile);
    const dialog = page.getByRole("dialog", { name: "Customize Overview", exact: true });
    const reset = dialog.getByRole("button", { name: "Reset layout", exact: true });
    const metricRows = dialog.getByRole("list", { name: "Metric cards", exact: true }).getByRole("listitem");
    await expect(metricRows).toHaveText(legacyMetrics);

    const other = await context.newPage();
    await other.goto("/");
    await demo(other, "en");
    await navigate(other, "Settings", isMobile);
    await chooseFile(other, isMobile, imported);
    await expect(other.getByText("已导入显示偏好。", { exact: true })).toBeVisible();
    await expectDisplay(other, "zh", "dark");
    const importedSnapshot = await stored(other);
    const { revision } = JSON.parse(importedSnapshot!);
    const layoutOverride = () => page.evaluate(key => localStorage.getItem(key), `${preferenceKey}.${revision}.overviewLayout`);
    const expectImportPreserved = async () => {
      expect(await stored(page)).toBe(importedSnapshot);
      expect(await layoutOverride()).toBeNull();
      expect(await effectiveStored(page)).toEqual(imported);
    };

    await page.bringToFront();
    await expect(metricRows).toHaveText(legacyMetrics);
    if (input === "keyboard") {
      await reset.focus();
      await page.keyboard.down("Enter");
      try {
        await expectLayoutReview(dialog, isMobile);
        await expectImportPreserved();
        await page.keyboard.down("Enter");
        await expectLayoutReview(dialog, isMobile);
        await expectImportPreserved();
      } finally {
        await page.keyboard.up("Enter");
      }
    } else if (isMobile) {
      await reset.scrollIntoViewIfNeeded();
      await expect(reset).toBeInViewport({ ratio: 1 });
      const bounds = await reset.boundingBox();
      expect(bounds).not.toBeNull();
      const { x, y, width, height } = bounds!;
      await page.touchscreen.tap(x + width / 2, y + height / 2);
      await page.touchscreen.tap(x + width / 2, y + height / 2);
    } else {
      await reset.dblclick();
    }
    const continueEditing = await expectLayoutReview(dialog, isMobile);
    await expect(reset).toBeDisabled();
    await expectImportPreserved();

    if (input === "keyboard") {
      const order = dialog.getByRole("region", { name: "Overview card order", exact: true });
      await page.keyboard.press("Shift+Tab");
      await expect(order).toBeFocused();
      await page.keyboard.press("PageDown");
      await expect.poll(() => order.evaluate((container) => container.scrollTop)).toBeGreaterThan(0);
      await page.keyboard.press("Tab");
      await expect(continueEditing).toBeFocused();
      await expectImportPreserved();
    }

    await acknowledgeLayoutReview(continueEditing, reset, isMobile);
    await expectImportPreserved();

    if (input === "keyboard") await page.keyboard.press("Enter");
    else if (isMobile) await reset.tap();
    else await reset.click();
    await expect(dialog.getByRole("status")).toHaveText("Default layout restored.");
    await expect(metricRows).toHaveText(["Download", "Upload", "Active connections", "Memory"]);
    await expect.poll(() => effectiveStored(page)).toEqual({
      ...imported,
      overviewLayout: {
        metrics: ["download", "upload", "connections", "memory"],
        panels: ["traffic", "instance", "outbounds", "logs"],
      },
    });
    expect(await stored(page)).toBe(importedSnapshot);
  });
}

test("Overview rejects an unsaved move from before a same-order import", async ({ context, page, isMobile }) => {
  await context.addInitScript(({ key, initial }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, initial);
  }, { key: preferenceKey, initial: fixtureBaseline });
  await page.addInitScript(key => {
    const write = Storage.prototype.setItem;
    let writesDenied = true;
    window.addEventListener("fixture-restore-layout-writes", () => { writesDenied = false; }, { once: true });
    Storage.prototype.setItem = function (name, value) {
      if (writesDenied && this === localStorage && name.startsWith(`${key}.`) && name.endsWith(".overviewLayout")) {
        throw new DOMException("Fixture layout writes unavailable", "QuotaExceededError");
      }
      write.call(this, name, value);
    };
  }, preferenceKey);
  await page.goto("/");
  await demo(page, "en");
  await activate(page.getByRole("button", { name: "Customize Overview", exact: true }), isMobile);
  const dialog = page.getByRole("dialog", { name: "Customize Overview", exact: true });
  const metricRows = dialog.getByRole("list", { name: "Metric cards", exact: true }).getByRole("listitem");
  const panelRows = dialog.getByRole("list", { name: "Detail panels", exact: true }).getByRole("listitem");
  const uploadUp = dialog.getByRole("button", { name: "Move Upload up", exact: true });

  await activate(dialog.getByRole("button", { name: "Move Recent logs up", exact: true }), isMobile);
  const unsavedPanels = ["Outbound groups", "Traffic activity", "Recent logs", "Instance details"];
  await expect(panelRows).toHaveText(unsavedPanels);
  expect(await effectiveStored(page)).toEqual(legacy);

  const other = await context.newPage();
  await other.goto("/");
  await demo(other, "en");
  await navigate(other, "Settings", isMobile);
  const sameOrderImport = { ...legacy, theme: "dark" };
  await chooseFile(other, isMobile, sameOrderImport);
  await expect(other.getByText("Display preferences imported.", { exact: true })).toBeVisible();
  const importedSnapshot = await stored(other);
  const { revision } = JSON.parse(importedSnapshot!);
  expect(revision).not.toBe(fixtureRevision);
  const layoutOverride = () => page.evaluate(key => localStorage.getItem(key), `${preferenceKey}.${revision}.overviewLayout`);

  await page.bringToFront();
  await expect(panelRows).toHaveText(unsavedPanels);
  await page.evaluate(() => window.dispatchEvent(new Event("fixture-restore-layout-writes")));
  await activate(uploadUp, isMobile);
  const continueEditing = await expectLayoutReview(dialog, isMobile);
  await expect(uploadUp).toBeDisabled();
  await expect(metricRows).toHaveText(legacyMetrics);
  await expect(panelRows).toHaveText(legacyPanels);
  expect(await stored(page)).toBe(importedSnapshot);
  expect(await layoutOverride()).toBeNull();
  expect(await effectiveStored(page)).toEqual(sameOrderImport);

  await acknowledgeLayoutReview(continueEditing, uploadUp, isMobile);
  expect(await stored(page)).toBe(importedSnapshot);
  expect(await layoutOverride()).toBeNull();
  expect(await effectiveStored(page)).toEqual(sameOrderImport);

  await activate(uploadUp, isMobile);
  await expect(dialog.getByRole("status")).toHaveText("Moved Upload to position 2 of 4.");
  await expect(metricRows).toHaveText(["Download", "Upload", "Active connections", "Memory"]);
  await expect(panelRows).toHaveText(legacyPanels);
  await expect.poll(() => effectiveStored(page)).toEqual({
    ...sameOrderImport,
    overviewLayout: { ...legacy.overviewLayout, metrics: ["download", "upload", "connections", "memory"] },
  });
  expect(await stored(page)).toBe(importedSnapshot);
});

test("Overview keeps a temporary import editable after another tab imports preferences", async ({ context, page, isMobile }) => {
  await page.addInitScript(({ key, initial }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, initial);
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (this === localStorage && name === key) throw new DOMException("Fixture import writes unavailable", "QuotaExceededError");
      write.call(this, name, value);
    };
  }, { key: preferenceKey, initial: fixtureBaseline });
  await page.goto("/");
  await demo(page, "en");
  await navigate(page, "Settings", isMobile);

  const other = await context.newPage();
  await other.goto("/");
  await demo(other, "en");
  await navigate(other, "Settings", isMobile);
  await chooseFile(other, isMobile, imported);
  await expect(other.getByText("已导入显示偏好。", { exact: true })).toBeVisible();
  const importedSnapshot = await stored(other);
  const { revision } = JSON.parse(importedSnapshot!);
  const layoutOverride = () => page.evaluate(key => localStorage.getItem(key), `${preferenceKey}.${revision}.overviewLayout`);

  await page.bringToFront();
  const temporary = {
    ...legacy,
    overviewLayout: {
      metrics: ["connections", "upload", "memory", "download"],
      panels: ["instance", "logs", "traffic", "outbounds"],
    },
  };
  await chooseFile(page, isMobile, temporary);
  await expect(page.getByText("Display preferences applied for this visit. Browser storage is unavailable.", { exact: true }))
    .toBeVisible();
  await navigate(page, "Overview", isMobile);
  const panelTitles = ["Instance details", "Recent logs", "Traffic activity", "Outbound groups"];
  await expectOverview(page, ["Active connections", "Upload", "Memory", "Download"], panelTitles);

  await activate(page.getByRole("button", { name: "Customize Overview", exact: true }), isMobile);
  const dialog = page.getByRole("dialog", { name: "Customize Overview", exact: true });
  await activate(dialog.getByRole("button", { name: "Move Upload up", exact: true }), isMobile);
  await expect(dialog.getByRole("status")).toHaveText("Moved Upload to position 1 of 4.");
  await expect(dialog.getByRole("list", { name: "Metric cards", exact: true }).getByRole("listitem"))
    .toHaveText(["Upload", "Active connections", "Memory", "Download"]);
  await expect(dialog.getByRole("list", { name: "Detail panels", exact: true }).getByRole("listitem")).toHaveText(panelTitles);
  await expectDisplay(page, "en", "light");
  expect(await stored(page)).toBe(importedSnapshot);
  expect(await layoutOverride()).toBeNull();
  expect(await effectiveStored(page)).toEqual(imported);
});

test("Concurrent display controls in two tabs persist independent changes to one import", async ({ context, page, isMobile }) => {
  test.skip(isMobile, "The cross-tab storage behavior is shared across viewports.");
  await context.addInitScript(key => {
    const write = Storage.prototype.setItem;
    const writes: [string, string][] = [];
    Object.defineProperty(window, "displayPreferenceWrites", { value: writes });
    Storage.prototype.setItem = function (name, value) {
      if (this === localStorage && name.startsWith(key)) writes.push([name, value]);
      write.call(this, name, value);
    };
  }, preferenceKey);
  await page.goto("/");
  await demo(page, "en");
  await navigate(page, "Settings", false);
  await chooseFile(page, false, legacy);
  await expect(page.getByText("Display preferences imported.", { exact: true })).toBeVisible();
  const baseline = await stored(page);
  const { revision } = JSON.parse(baseline!);

  const other = await context.newPage();
  await other.goto("/");
  await demo(other, "en");
  const tabs = [page, other];
  for (const tab of tabs) {
    await expectDisplay(tab, "en", "light");
    await tab.getByRole("button", { name: "Display settings", exact: true }).press("Enter");
  }

  // Exercise the real controls together and record their destinations, independent of renderer scheduling.
  await Promise.all([
    page.getByRole("radio", { name: "Dark theme", exact: true }).click(),
    other.getByRole("radio", { name: "简体中文", exact: true }).click(),
  ]);
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect(other.locator("html")).toHaveAttribute("lang", "zh-CN");
  const writes = await Promise.all(tabs.map(tab => tab.evaluate(() => Reflect.get(window, "displayPreferenceWrites"))));
  expect(writes).toEqual([
    [[preferenceKey, baseline], [`${preferenceKey}.${revision}.theme`, "dark"]],
    [[`${preferenceKey}.${revision}.language`, "zh"]],
  ]);
  expect(await stored(page)).toBe(baseline);
  expect(await effectiveStored(page)).toEqual({ ...legacy, theme: "dark", language: "zh" });

  const fresh = await context.newPage();
  await fresh.goto("/");
  await expectDisplay(fresh, "zh", "dark");
  await demo(fresh, "zh");
  await expectOverview(fresh, ["下载", "活动连接", "上传", "内存"], ["代理组", "流量趋势", "实例信息", "最近日志"]);
});
