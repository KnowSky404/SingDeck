import { expect, test } from "@playwright/test";

test("configuration health filters, refreshes and copies reported warnings", async ({
  page,
  isMobile,
}) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
  const entry = page.getByRole("link", { name: "View configuration health" });
  await entry.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/configuration-health$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Configuration health" }),
  ).toHaveCount(1);

  const warnings = page.getByRole("main").getByRole("listitem");
  await expect(warnings).toHaveCount(2);
  await expect(warnings.first()).toContainText("Demo deprecation warning");
  await expect(
    warnings.first().getByRole("link", { name: "Migration guide" }),
  ).toHaveAttribute("href", "https://sing-box.sagernet.org/migration/");
  await expect(warnings.last()).toContainText("Demo routine deprecation");
  await expect(warnings.last().getByRole("link")).toHaveCount(0);
  await expect(
    warnings.first().getByText("1.15.0", { exact: true }),
  ).toBeVisible();

  const filter = page.getByRole("combobox", { name: "Warning urgency" });
  await filter.click();
  await page.getByRole("option", { name: "Other deprecations" }).click();
  await expect(warnings).toHaveCount(1);
  await expect(warnings.first()).toContainText("Demo routine deprecation");
  await page.getByRole("button", { name: "Copy warning" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Warning copied." }),
  ).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("Demo routine deprecation");
  expect(copied).toContain("Scheduled removal version 1.17.0");
  expect(copied).not.toContain("sagernet.org.invalid");

  const refresh = page.getByRole("button", { name: "Refresh warnings" });
  await refresh.click();
  await expect(refresh).toHaveAttribute("aria-busy", "true");
  await expect(refresh).toBeEnabled();
  await expect(warnings).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
