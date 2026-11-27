import { readFile } from "node:fs/promises";
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

test("copies and exports logs only after the current search settles", async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  await page.addInitScript(() => {
    let text = "";
    Object.defineProperty(navigator, "clipboard", {
      value: {
        readText: async () => text,
        writeText: async (value: string) => { text = value; },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await page.getByRole("link", { name: "Logs", exact: true }).click();

  const matching = "demo warning: retrying a probe";
  const unrelated = "demo error: simulated probe failure";
  const search = page.getByRole("textbox", { name: "Search logs", exact: true });
  const copy = page.getByRole("button", { name: "Copy filtered logs", exact: true });
  const save = page.getByRole("button", { name: "Export filtered logs", exact: true });
  await expect(page.getByText(unrelated, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(copy).toBeEnabled();
  await expect(save).toBeEnabled();

  const query = "RETRYING A PROBE";
  const pending = await search.evaluate(async (input, { query, unrelated }) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: query }));
    // Observe the urgent input commit before React can finish the deferred list update.
    await Promise.resolve();
    return {
      input: (input as HTMLInputElement).value,
      oldRow: [...document.querySelectorAll(".log-console .log-message")].some(row => row.textContent === unrelated),
      copyDisabled: document.querySelector<HTMLButtonElement>('button[aria-label="Copy filtered logs"]')?.disabled,
      exportDisabled: document.querySelector<HTMLButtonElement>('button[aria-label="Export filtered logs"]')?.disabled,
    };
  }, { query, unrelated });
  expect(pending).toEqual({ input: query, oldRow: true, copyDisabled: true, exportDisabled: true });

  const logConsole = page.locator(".log-console");
  await expect(logConsole.locator(".log-message")).toHaveText([matching]);
  const receivedAt = await logConsole.locator("time").getAttribute("datetime");
  expect(receivedAt).toMatch(/T.*Z$/);
  const expected = `${receivedAt} WARN ${matching}`;
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
  const downloaded = page.waitForEvent("download");
  await save.click();
  expect(await readFile(await (await downloaded).path(), "utf8")).toBe(expected);
});
