import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

test.use({ trace: "off" });

test("browser uses the official native service through CORS and built-in dashboard hosting", async ({
  page,
  context,
}, info) => {
  test.skip(
    !process.env.SING_BOX_BINARY || info.project.name !== "desktop",
    "Requires the official sing-box binary and a production build; desktop integration fixture.",
  );
  test.setTimeout(45_000);
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
    await page
      .getByRole("button", { name: "Expand Primary route", exact: true })
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
    const remember = page.getByRole("switch", { name: "Remember this device" });
    await expect(remember).not.toBeChecked();
    const refuseConfirmation = () => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "singdeck.remembered-connection" && value.startsWith("+"))
          throw new DOMException(
            "Confirmation unavailable",
            "QuotaExceededError",
          );
        setItem.call(this, key, value);
      };
    };
    await page.evaluate(refuseConfirmation);
    await page.addInitScript(refuseConfirmation);
    await page
      .getByLabel("API endpoint", { exact: true })
      .fill("http://127.0.0.1:19190///");
    await page.getByLabel("Bearer token", { exact: true }).fill(secret);
    await remember.click();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Logs", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Saving this connection…")).toHaveCount(0);
    await expect(
      page.getByText("Settings not persisted", { exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => localStorage.getItem("singdeck.remembered-connection")?.[0],
      ),
    ).toBe("?");
    const inWebStorage = await page.evaluate(
      (token) =>
        JSON.stringify({
          local: { ...localStorage },
          session: { ...sessionStorage },
        }).includes(token),
      secret,
    );
    expect(inWebStorage).toBe(false);

    const logsUrl = "http://127.0.0.1:19190/dashboard/#/logs";
    const profilesKey = "singdeck.profiles.v1";
    const originalProfiles = await page.evaluate((key) => {
      const original = localStorage.getItem(key)!;
      const profiles = JSON.parse(original);
      const duplicate = { ...profiles[0], endpoint: "http://127.0.0.1:19999" };
      localStorage.setItem(key, JSON.stringify([duplicate, ...profiles]));
      return original;
    }, profilesKey);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Connect", exact: true }),
    ).toBeEnabled();
    await expect(page.getByLabel("Bearer token", { exact: true })).toHaveValue(
      "",
    );
    await expect(
      page.getByRole("button", { name: "Forget saved connection" }),
    ).toBeVisible();
    await page.evaluate(
      ([key, original]) => localStorage.setItem(key, original),
      [profilesKey, originalProfiles],
    );

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Logs", exact: true }),
    ).toBeVisible();
    expect(page.url()).toBe(logsUrl);
    await page.close();

    let reopened = await context.newPage();
    await reopened.goto(logsUrl);
    await expect(
      reopened.getByRole("heading", { name: "Logs", exact: true }),
    ).toBeVisible();
    const markerKey = "singdeck.remembered-connection";

    await reopened.evaluate((key) => {
      const marker = localStorage.getItem(key)!;
      localStorage.setItem(key, "?" + marker.slice(1));
    }, markerKey);
    const delayed = await context.newPage();
    await delayed.addInitScript(() => {
      let startupReads = 0;
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = (name, version) => {
        const request = open(name, version);
        if (startupReads++ < 2) {
          document.documentElement.dataset.startupReads = String(startupReads);
          Object.defineProperty(request, "onsuccess", { set() {} });
        }
        return request;
      };
    });
    await delayed.goto(logsUrl);
    await expect(delayed.locator("html")).toHaveAttribute(
      "data-startup-reads",
      "2",
    );
    await delayed.evaluate(() => {
      const lockDeadline = new AbortController();
      const timeout = AbortSignal.timeout;
      let firstTimeout = true;
      AbortSignal.timeout = (milliseconds) => {
        if (!firstTimeout) return timeout(milliseconds);
        firstTimeout = false;
        return lockDeadline.signal;
      };
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = (name, version) => {
        const request = open(name, version);
        request.addEventListener("success", () => lockDeadline.abort(), {
          once: true,
        });
        return request;
      };
    });
    await delayed.getByRole("button", { name: "Cancel connection" }).click();
    const connect = delayed.getByRole("button", {
      name: "Connect",
      exact: true,
    });
    await expect(connect).toBeEnabled();
    expect(
      await delayed.evaluate(
        (key) => localStorage.getItem(key)?.[0] ?? "",
        markerKey,
      ),
    ).not.toMatch(/[+?]/);
    await delayed.reload();
    await expect(connect).toBeEnabled();
    await delayed.close();

    await reopened.close();
    reopened = await context.newPage();
    await reopened.goto(logsUrl);
    await reopened
      .getByRole("switch", { name: "Remember this device" })
      .click();
    await reopened.getByLabel("Bearer token", { exact: true }).fill(secret);
    await reopened
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await expect(
      reopened.getByRole("heading", { name: "Logs", exact: true }),
    ).toBeVisible();
    await expect(reopened.getByText("Saving this connection…")).toHaveCount(0);

    await reopened.evaluate(() => {
      indexedDB.open = () => {
        throw new DOMException("Cleanup interrupted", "AbortError");
      };
    });
    const unlock = await reopened.evaluateHandle(
      (key) =>
        new Promise<() => void>((acquired) => {
          void navigator.locks.request(
            key,
            () => new Promise<void>((release) => acquired(release)),
          );
        }),
      markerKey,
    );
    await reopened
      .getByRole("button", { name: "Current connection", exact: true })
      .click();
    await reopened
      .getByRole("menuitem", { name: "Disconnect", exact: true })
      .click();
    await expect(
      reopened.getByText("Disconnecting…", { exact: true }),
    ).toBeVisible();
    await expect(
      reopened.getByText(/^Automatic reconnect may still be enabled/),
    ).toBeVisible();
    await unlock.evaluate((release) => release());
    await unlock.dispose();
    await reopened
      .getByRole("button", { name: "Forget saved connection" })
      .click();
    const tokenInput = reopened.getByLabel("Bearer token", { exact: true });
    await expect(tokenInput).toBeVisible();
    await reopened.reload();
    await expect(tokenInput).toHaveValue("");
    await expect
      .poll(() =>
        reopened.evaluate(
          () =>
            new Promise<number>((resolve, reject) => {
              const open = indexedDB.open("singdeck.remembered-connection", 1);
              open.onerror = () => reject(open.error);
              open.onsuccess = () => {
                const db = open.result;
                const transaction = db.transaction("connections", "readonly");
                const count = transaction.objectStore("connections").count();
                transaction.oncomplete = () => {
                  db.close();
                  resolve(count.result);
                };
                transaction.onabort = () => reject(transaction.error);
              };
            }),
        ),
      )
      .toBe(0);

    await tokenInput.fill(secret);
    await reopened
      .getByRole("switch", { name: "Remember this device" })
      .click();
    await reopened
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await expect(
      reopened.getByRole("heading", { name: "Logs", exact: true }),
    ).toBeVisible();
    await expect(reopened.getByText("Saving this connection…")).toHaveCount(0);
    const versionRpc = "**/daemon.StartedService/GetVersion";
    await reopened.route(versionRpc, (route) => route.fulfill({ status: 403 }));
    await reopened.reload();
    const forget = reopened.getByRole("button", {
      name: "Forget saved connection",
    });
    await expect(forget).toBeVisible();
    await reopened.unroute(versionRpc);
    await reopened.route(versionRpc, () => {});
    await reopened
      .getByRole("button", { name: "Test connection", exact: true })
      .click();
    await reopened
      .getByRole("button", { name: "Cancel connection", exact: true })
      .click();
    await expect(forget).toBeVisible();
    await reopened.unroute(versionRpc);
    await reopened
      .getByRole("button", { name: "Explore demo", exact: true })
      .click();
    await expect(
      reopened.getByText("Mock mode", { exact: true }),
    ).toBeVisible();
    await reopened
      .getByRole("button", { name: "Current connection", exact: true })
      .click();
    await reopened
      .getByRole("menuitem", { name: "Disconnect", exact: true })
      .click();
    await forget.click();
    await expect(
      reopened.getByRole("button", { name: "Connect", exact: true }),
    ).toBeEnabled();
    await reopened.goto(logsUrl);
    await reopened.reload();
    await expect(
      reopened.getByRole("button", { name: "Connect", exact: true }),
    ).toBeEnabled();

    await reopened
      .getByRole("switch", { name: "Remember this device" })
      .click();
    await tokenInput.fill(secret);
    await reopened
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await expect(
      reopened.getByRole("heading", { name: "Logs", exact: true }),
    ).toBeVisible();
    await expect(reopened.getByText("Saving this connection…")).toHaveCount(0);
    await reopened.route(versionRpc, (route) => route.fulfill({ status: 401 }));
    await reopened.reload();
    await expect(reopened.getByText(/^Authentication failed/)).toBeVisible();
    await expect(tokenInput).toHaveValue("");
    await reopened.unroute(versionRpc);
    await reopened.reload();
    await expect(
      reopened.getByRole("button", { name: "Connect", exact: true }),
    ).toBeEnabled();
    await expect(reopened.getByRole("navigation")).toHaveCount(0);

    let resume!: () => void;
    const resumeOlderConnection = new Promise<void>((resolve) => {
      resume = resolve;
    });
    await reopened.route(versionRpc, async (route) => {
      await resumeOlderConnection;
      await route.continue();
    });
    const olderHandshake = reopened.waitForRequest(versionRpc);
    await tokenInput.fill(secret);
    await reopened
      .getByRole("switch", { name: "Remember this device" })
      .click();
    await reopened
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await olderHandshake;

    await expect
      .poll(() =>
        reopened.evaluate((key) => localStorage.getItem(key)?.[0], markerKey),
      )
      .toBe("?");
    const newer = await context.newPage();
    await newer.addInitScript(() => {
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = (name, version) => {
        const request = open(name, version);
        Object.defineProperty(request, "onsuccess", { set() {} });
        return request;
      };
    });
    await newer.goto(logsUrl);
    await newer.getByRole("button", { name: "Cancel connection" }).click();
    await expect(
      newer.getByRole("button", { name: "Connect", exact: true }),
    ).toBeEnabled();
    expect(
      await newer.evaluate((key) => localStorage.getItem(key)?.[0], markerKey),
    ).toBe("?");
    await newer.getByLabel("Bearer token", { exact: true }).fill(secret);
    await newer.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(
      newer.getByRole("heading", { name: "Logs", exact: true }),
    ).toBeVisible();
    await newer.close();
    resume();
    await expect(
      reopened.getByRole("heading", { name: "Logs", exact: true }),
    ).toBeVisible();
    await expect(reopened.getByText("Saving this connection…")).toHaveCount(0);
    await reopened.unroute(versionRpc);
    await reopened.reload();
    await expect(
      reopened.getByRole("button", { name: "Connect", exact: true }),
    ).toBeEnabled();
    await expect(tokenInput).toHaveValue("");

    await reopened
      .getByRole("switch", { name: "Remember this device" })
      .click();
    await tokenInput.fill(secret);
    await reopened
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await expect(
      reopened.getByRole("heading", { name: "Logs", exact: true }),
    ).toBeVisible();
    await expect(reopened.getByText("Saving this connection…")).toHaveCount(0);

    const canceling = await context.newPage();
    await canceling.addInitScript(() => {
      crypto.subtle.decrypt = () => new Promise(() => {});
    });
    await canceling.goto(logsUrl);
    const cancel = canceling.getByRole("button", { name: "Cancel connection" });
    await expect(cancel).toBeVisible();
    const replacement = "+other-tab-id";
    await reopened.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [markerKey, replacement],
    );
    await cancel.click();
    await expect(
      canceling.getByRole("button", { name: "Connect", exact: true }),
    ).toBeEnabled();
    expect(
      await reopened.evaluate((key) => localStorage.getItem(key), markerKey),
    ).toBe(replacement);
    await canceling.close();
  } finally {
    for (const tab of context.pages()) {
      await tab
        .locator('input[type="password"]')
        .evaluateAll((inputs) => {
          for (const input of inputs) (input as HTMLInputElement).value = "";
        })
        .catch(() => {});
    }
    if (child.exitCode === null) {
      const exited = new Promise<void>((r) => child.once("exit", () => r()));
      child.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
