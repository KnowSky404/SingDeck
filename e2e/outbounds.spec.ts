import { expect, test } from "@playwright/test";

test("outbound inventory filters, follows nested selections and observes streamed test history", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page.getByText("Mock mode", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Outbounds", exact: true }).first().click();
  await expect(page).toHaveURL(/#\/proxies$/);
  await expect(page.getByRole("heading", { name: "Outbounds", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Expand Primary route", exact: true }).click();
  await page.getByRole("button", { name: "Select Auto route", exact: true }).click();
  await expect(page.getByRole("button", { name: "Selected: Auto route", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "All outbounds", exact: true }).click();

  const list = page.getByRole("list", { name: "All outbounds" });
  const independent = list.getByRole("listitem").filter({ hasText: "Independent direct" });
  await expect(independent).toContainText("No result");
  await expect(list.getByRole("listitem").filter({ has: page.getByText("Auto route", { exact: true }) })).toContainText("Selected");
  await list.getByRole("button", { name: "Group details for Primary route", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Primary route" });
  await expect(details).toContainText("Primary route → Auto route → Singapore 01");
  await details.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("combobox", { name: "Sort outbounds", exact: true }).click();
  await page.getByRole("option", { name: "Lowest latency", exact: true }).click();
  await expect(list.getByRole("listitem").first()).toContainText("Tokyo 01");
  await page.getByRole("radio", { name: "Compact cards", exact: true }).click();
  await expect(list).toHaveClass(/proxy-cards/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.getByRole("combobox", { name: "Protocol filter", exact: true }).click();
  await page.getByRole("option", { name: "direct", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  const search = page.getByRole("textbox", { name: "Search outbounds", exact: true });
  await search.fill("independent");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await independent.getByRole("button", { name: "Test Independent direct", exact: true }).click();
  await expect(independent.locator("time")).toHaveAttribute("datetime", /T/);
  await expect(page.getByRole("status").filter({ hasText: "Fresh latency observed for Independent direct." })).toBeVisible();

  await search.clear();
  await page.getByRole("button", { name: "Test matching nodes (2)", exact: true }).click();
  const direct = list.getByRole("listitem").filter({ has: page.getByText("Direct", { exact: true }) });
  await expect(direct.locator("time")).toHaveAttribute("datetime", /T/);
  expect(errors).toEqual([]);
});
