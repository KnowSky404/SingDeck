import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

test("browser uses the official native service through CORS and built-in dashboard hosting", async ({
  page,
}, info) => {
  test.skip(
    !process.env.SING_BOX_BINARY || info.project.name !== "desktop",
    "Requires the official sing-box binary and a production build; desktop integration fixture.",
  );
  const directory = await mkdtemp(`${tmpdir()}/singdeck-browser-`);
  const secret = randomBytes(24).toString("hex");
  const config = JSON.parse(
    await readFile("examples/sing-box-1.14.0.json", "utf8"),
  );
  config.services[0].secret = secret;
  config.services[0].listen_port = 19190;
  config.services[0].dashboard.path = resolve("dist");
  config.inbounds[0].listen_port = 19180;
  await writeFile(`${directory}/config.json`, JSON.stringify(config), {
    mode: 0o600,
  });
  const child = spawn(
    process.env.SING_BOX_BINARY!,
    ["run", "-c", `${directory}/config.json`],
    { stdio: "ignore" },
  );
  try {
    await expect
      .poll(async () => {
        try {
          return (await fetch("http://127.0.0.1:19190/dashboard/")).ok;
        } catch {
          return false;
        }
      })
      .toBe(true);
    await page.goto("/#/settings");
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "API endpoint", exact: true })
      .fill("http://127.0.0.1:19190");
    await page.getByLabel("Bearer token", { exact: true }).fill(secret);
    await page
      .getByRole("button", { name: "Test connection", exact: true })
      .click();
    await expect(
      page.getByText("Connection verified: sing-box 1.14.0 · API 4."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: /^Connected$/ }),
    ).toBeVisible();
    await expect(page.getByText("Mock mode", { exact: true })).toHaveCount(0);
    await page
      .getByRole("link", { name: "Proxies", exact: true })
      .first()
      .click();
    const backup = page
      .locator(".proxy-row")
      .filter({ has: page.getByText("direct-backup", { exact: true }) });
    await backup
      .getByRole("button", { name: "Select direct-backup", exact: true })
      .click();
    await expect(
      backup.getByRole("button", {
        name: "Selected: direct-backup",
        exact: true,
      }),
    ).toBeVisible();
    await page.goto("http://127.0.0.1:19190/dashboard/#/settings");
    await expect(
      page.getByRole("heading", { name: "Connect your network.", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "API endpoint", exact: true }),
    ).toHaveValue("http://127.0.0.1:19190");
    await page.getByLabel("Bearer token", { exact: true }).fill(secret);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: /^Connected$/ }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Logs", exact: true }).first().click();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Connect your network.", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Bearer token", { exact: true })).toHaveValue(
      "",
    );
    await page.getByLabel("Bearer token", { exact: true }).fill(secret);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Logs", exact: true }),
    ).toBeVisible();
    expect(page.url()).toBe("http://127.0.0.1:19190/dashboard/#/logs");
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise<void>((r) => child.once("exit", () => r()));
      child.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
