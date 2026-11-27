import { expect, test } from "@playwright/test";

test("notification center isolates native messages, filters history, and requests desktop permission on demand", async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, "Notification", {
      value: class {
        static permission = "default";
        static async requestPermission() {
          document.documentElement.dataset.permissionRequested = "true";
          this.permission = "granted";
          return this.permission;
        }
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  const unread = page.getByRole("link", { name: "Notifications (1 unread)", exact: true });
  await unread.click();
  await expect(page).toHaveURL(/#\/notifications$/);
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeAttached();
  await expect(page.getByText("Native capture runs while this page is open. The core has no history replay.")).toBeVisible();
  await expect(page.getByText("Native notifications received during this visit.")).toBeVisible();

  const native = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Demo core notification" }) });
  await expect(native.getByText("Native Notification", { exact: true })).toBeVisible();
  await expect(native.getByText("Canceled by core", { exact: true })).toBeVisible();
  await expect(native.getByRole("link")).toHaveCount(0);
  const local = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "The core reported configuration deprecations." }) });
  await expect(local.getByRole("link", { name: "Open related page" })).toHaveAttribute("href", "#/configuration-health");
  await expect(local.getByText("SingDeck Local Notification")).toBeVisible();

  await page.getByRole("button", { name: "Mark all as read", exact: true }).click();
  await expect(page.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();
  await local.getByRole("button", { name: "Mark as unread", exact: true }).click();
  await expect(unread).toBeVisible();
  await page.getByRole("combobox", { name: "Notification source" }).click();
  await page.getByRole("option", { name: "SingDeck Local Notification", exact: true }).click();
  await expect(native).toHaveCount(0);
  await page.getByRole("combobox", { name: "Notification level" }).click();
  await page.getByRole("option", { name: "Warning", exact: true }).click();
  await expect(local).toBeVisible();
  await local.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.getByText("No matching notifications")).toBeVisible();

  await expect(page.locator("html")).not.toHaveAttribute("data-permission-requested");
  await page.getByRole("button", { name: "Enable desktop alerts", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-permission-requested", "true");
  await expect(page.getByRole("button", { name: "Disable desktop alerts", exact: true })).toBeVisible();
  expect(await page.locator("header.topbar").evaluate((bar) => bar.scrollWidth <= bar.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});
