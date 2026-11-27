import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("connection export downloads the matching retained records as JSON", async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  let downloadCount = 0;
  page.on("download", () => downloadCount++);
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page.getByText("Mock mode", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Connections", exact: true }).first().click();

  const search = page.getByRole("textbox", { name: "Search connections", exact: true });
  const exportButton = page.getByRole("button", { name: "Export matching connections", exact: true });
  await search.fill("unreported-connection-record");
  await expect(page.getByText(/^0 matching connections\b/)).toBeVisible();
  await expect(exportButton).toBeDisabled();

  await page.getByRole("combobox", { name: "Status filter", exact: true }).click();
  await page.getByRole("option", { name: "Closed", exact: true }).click();
  const rawSearch = "  API.GITHUB.COM   127.0.0.1:50000  ";
  await search.fill(rawSearch);
  await expect(page.getByText(/^2 matching connections\b/)).toBeVisible();
  await expect(exportButton).toBeEnabled();
  expect(downloadCount).toBe(0);

  const downloading = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloading;
  expect(downloadCount).toBe(1);
  expect(download.suggestedFilename()).toMatch(/^singdeck-connections-\d+\.json$/);
  const json = await readFile(await download.path(), "utf8");
  const report = JSON.parse(json);
  expect(report).toMatchObject({
    source: "mock",
    exportedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
    scope: "retained-matching-connections",
    snapshotCurrent: true,
    retentionLimitReached: false,
    units: { timestamps: "unix-ms", traffic: "bytes" },
    chainOrder: "leaf-first",
  });
  expect(report.connections).toHaveLength(2);
  expect(report.connections.map((record: { id: string }) => record.id)).toEqual(
    expect.arrayContaining(["mock-closed-1", "mock-closed-2"]),
  );
  for (const record of report.connections) {
    expect(record).toMatchObject({
      domain: "api.github.com",
      source: "127.0.0.1:50000",
      ipVersion: 4,
      fromOutbound: null,
      user: null,
      processInfo: null,
      chainList: ["Singapore 01", "Primary route"],
      createdAt: expect.stringMatching(/^[1-9]\d*$/),
      closedAt: expect.stringMatching(/^[1-9]\d*$/),
      uplinkTotal: "12000",
      downlinkTotal: "134000",
    });
  }
  for (const property of ["token", "credentials", "endpoint", "profile", "search", "filters"]) {
    expect(report).not.toHaveProperty(property);
  }
  expect(json).not.toContain(rawSearch);
  expect(json).not.toContain(new URL(page.url()).origin);
});
