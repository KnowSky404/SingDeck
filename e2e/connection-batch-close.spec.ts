import { expect, test } from "@playwright/test";

test("batch close requires narrowing and closes only confirmed matches", async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await page.getByRole("link", { name: "Connections", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
  const batch = page.getByRole("button", { name: "Close matching connections", exact: true });
  const search = page.getByRole("textbox", { name: "Search connections" });
  await expect(page.getByRole("button", { name: "Close all connections" })).toBeEnabled();
  await expect(batch).toBeDisabled();
  await search.fill("no-match.example");
  await expect(page.getByText("0 matching connections · 50 rows per page")).toBeVisible();
  await expect(batch).toBeDisabled();

  await search.fill("api.github.com");
  await expect(batch).toBeEnabled();
  await batch.click();
  const dialog = page.getByRole("dialog", { name: "Close matching active connections?" });
  await expect(dialog).toContainText("7 active connections matching the current filters across all pages");
  expect(await dialog.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= document.documentElement.clientWidth;
  })).toBe(true);
  await page.keyboard.press("Escape");
  await expect(batch).toBeFocused();
  await expect(page.getByRole("button", { name: "Details for mock-1", exact: true })).toBeVisible();

  await batch.click();
  await dialog.getByRole("button", { name: "Close matching connections", exact: true }).click();
  await expect(page.getByText("Requests acknowledged 7 · Already closed 0 · Requests unsent 0")).toBeVisible();
  await expect(page.getByText("0 matching connections · 50 rows per page")).toBeVisible();
  await expect(batch).toBeDisabled();
  await search.clear();
  await expect(page.getByRole("button", { name: "Details for mock-2", exact: true })).toBeVisible();
  await expect(page.getByText("21 matching connections · 50 rows per page")).toBeVisible();
  expect(errors).toEqual([]);
});
