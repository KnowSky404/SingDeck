import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("diagnostics require consent, cancel cleanly, and report streamed measurements", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await page.getByRole("link", { name: "Diagnostics", exact: true }).first().click();
  await expect(page).toHaveURL(/#\/diagnostics$/);
  await expect(page.getByRole("heading", { name: "Diagnostics", exact: true })).toBeVisible();
  await expect(page.getByText("Mock mode", { exact: true })).toBeVisible();
  await expect(page.getByText("Test report", { exact: true })).toHaveCount(0);

  await page.getByRole("textbox", { name: "Test configuration URL" }).fill("https://measure.example.org/config");
  const run = page.getByRole("button", { name: "Run test", exact: true });
  await expect(run).toBeDisabled();
  await page.getByRole("checkbox", { name: /I authorize the core to fetch/ }).check();
  await run.click();
  await page.getByRole("button", { name: "Cancel test", exact: true }).click();
  await expect(page.getByText("Diagnostic canceled before completion.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export report" })).toHaveCount(0);

  await page.getByRole("textbox", { name: "Test configuration URL" }).clear();
  await page.getByRole("checkbox", { name: "Keep results for this page" }).check();
  await page.getByRole("combobox", { name: "Outbound", exact: true }).click();
  await page.getByRole("option", { name: /Independent direct/ }).click();
  await run.click();
  await expect(page.getByRole("status").filter({ hasText: /^Completed$/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /capacity over time/ })).toBeVisible();
  await expect(page.getByText("Test comparison", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export report" }).click();
  const report = JSON.parse(await readFile(await (await download).path(), "utf8"));
  expect(report).toMatchObject({
    tool: "networkQuality",
    source: "mock",
    outboundTag: "Independent direct",
    downloadBitsPerSecond: "30000000",
    uploadRPM: 430,
    idleLatencyMs: 31,
    elapsedMs: 2700,
  });
  expect(report).not.toHaveProperty("configURL");

  await page.getByRole("radio", { name: "STUN / NAT" }).click();
  await run.click();
  await expect(page.getByText("Binding response received")).toBeVisible();
  await expect(page.getByText("203.0.113.24:42424")).toBeVisible();
  await expect(page.getByText("Address-dependent", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.viewportSize()!.width);
  expect(errors).toEqual([]);
});
