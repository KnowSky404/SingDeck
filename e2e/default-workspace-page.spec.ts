import { expect, test, type Page } from "@playwright/test";

const preferenceKey = "singdeck.default-workspace-page";
const settings = (page: Page) => page.getByRole("button", { name: "Display settings", exact: true });
const picker = (page: Page) => page.getByRole("combobox", { name: "Default workspace page", exact: true });

test("sets the default page in Display settings while Demo still starts on Overview", async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/#/settings/usbip");
  await expect(page.getByRole("navigation")).toHaveCount(0);
  if (isMobile) {
    await settings(page).tap();
    await picker(page).tap();
  } else {
    await settings(page).press("Enter");
    await expect(page.getByRole("radio", { name: "System theme", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("radio", { name: "English", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(picker(page)).toBeFocused();
    await page.keyboard.press("Enter");
  }

  const options = page.getByRole("option");
  await expect(options).toHaveText([
    "Overview", "Outbounds", "Connections", "Logs", "Runtime monitor", "Diagnostics", "Settings",
  ]);
  const logs = page.getByRole("option", { name: "Logs", exact: true });
  if (isMobile) {
    await expect(logs).toBeInViewport({ ratio: 1 });
    await logs.tap();
  } else {
    await expect(page.getByRole("option", { name: "Overview", exact: true })).toBeFocused();
    for (const label of ["Outbounds", "Connections", "Logs"]) {
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("option", { name: label, exact: true })).toBeFocused();
    }
    await page.keyboard.press("Enter");
    await expect(picker(page)).toBeFocused();
  }
  await expect(picker(page)).toHaveText("Logs");
  expect(await page.evaluate(key => localStorage.getItem(key), preferenceKey)).toBe("/logs");
  await expect(page).toHaveURL(/#\/settings\/usbip$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.reload();
  await settings(page).click();
  await expect(picker(page)).toHaveText("Logs");
  await settings(page).click();
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
});

test("falls back for unsupported or unreadable default-page storage and keeps the current choice", async ({ page }) => {
  await page.addInitScript(key => {
    if (location.search === "?unsupported") localStorage.setItem(key, "/settings/usbip");
    if (location.search === "?unavailable") {
      const read = Storage.prototype.getItem;
      const save = Storage.prototype.setItem;
      Storage.prototype.getItem = function (name) {
        if (name === key) throw new DOMException("Unavailable", "SecurityError");
        return read.call(this, name);
      };
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new DOMException("Unavailable", "SecurityError");
        save.call(this, name, value);
      };
    }
  }, preferenceKey);

  await page.goto("/?unsupported");
  await settings(page).click();
  await expect(picker(page)).toHaveText("Overview");
  expect(await page.evaluate(key => localStorage.getItem(key), preferenceKey)).toBe("/settings/usbip");

  await page.goto("/?unavailable");
  await settings(page).click();
  await expect(picker(page)).toHaveText("Overview");
  await picker(page).click();
  await page.getByRole("option", { name: "Settings", exact: true }).click();
  await expect(picker(page)).toHaveText("Settings");
  await settings(page).click();
  await settings(page).click();
  await expect(picker(page)).toHaveText("Settings");
  await expect(page).toHaveURL(/\?unavailable$/);
  await page.reload();
  await settings(page).click();
  await expect(picker(page)).toHaveText("Overview");
});

test("keeps the default-page picker reachable when Display settings needs to scroll", async ({ page, isMobile }) => {
  await page.setViewportSize({ width: 420, height: 250 });
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Display settings", exact: true });
  if (isMobile) {
    await settings(page).tap();
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + box!.width / 2;
    const start = box!.y + box!.height - 12;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: start }] });
    for (let step = 1; step <= 6; step++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: start - (box!.height - 24) * step / 6 }],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => dialog.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  } else {
    await settings(page).press("Enter");
    await expect(dialog.getByRole("radio", { name: "System theme", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("radio", { name: "English", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(picker(page)).toBeFocused();
  }
  await expect(picker(page)).toBeInViewport({ ratio: 1 });
  if (isMobile) await picker(page).tap();
  else await page.keyboard.press("Enter");
  const outbounds = page.getByRole("option", { name: "Outbounds", exact: true });
  if (isMobile) await outbounds.tap();
  else {
    await page.keyboard.press("ArrowDown");
    await expect(outbounds).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(picker(page)).toBeFocused();
  }
  await expect(picker(page)).toHaveText("Outbounds");
  expect(await page.evaluate(key => localStorage.getItem(key), preferenceKey)).toBe("/proxies");
});
