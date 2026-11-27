import { expect, test } from "@playwright/test";

test("keeps core log clearing separate and waits for the subscribed reset", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await page.getByRole("link", { name: "Logs", exact: true }).click();
  const oldLog = page.getByText("demo error: simulated probe failure", {
    exact: true,
  });
  const clear = page.getByRole("button", { name: "Clear core buffer" });
  const dialog = page.getByRole("dialog", {
    name: "Clear the core log buffer?",
  });
  await expect(oldLog).toBeVisible();
  await clear.click();
  await expect(dialog).toContainText("shared by clients of this core");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(oldLog).toBeVisible();
  await clear.click();
  await dialog.getByRole("button", { name: "Clear core buffer" }).click();
  await expect(
    page.getByRole("status").filter({
      hasText: "Core log buffer clear requested.",
    }),
  ).toBeVisible();
  await expect(oldLog).toBeHidden();
});
