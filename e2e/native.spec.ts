import { test as base, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  serveDiagnostics,
  stunBindingResponse,
  stunFixtureDNS,
  stunFixtureHost,
} from "../tests/fixtures/diagnostics";

function holdConnectionLock(page: Page, key: string) {
  return page.evaluateHandle(
    (key) =>
      new Promise<() => void>((acquired) => {
        void navigator.locks.request(
          key,
          () => new Promise<void>((release) => acquired(release)),
        );
      }),
    key,
  );
}

function simulateVisualViewport(
  page: Page,
  dimensions: { width: number; height: number; offsetTop: number; offsetLeft: number },
) {
  return page.evaluate((dimensions) => {
    const viewport = window.visualViewport!;
    for (const [property, value] of Object.entries(dimensions))
      Object.defineProperty(viewport, property, { configurable: true, value });
    viewport.dispatchEvent(new Event("resize"));
  }, dimensions);
}

const test = base.extend<{ core: { secret: string; httpPort: number; stunServer: string } }>({
  core: async ({ baseURL }, use, info) => {
    info.skip(
      !process.env.SING_BOX_BINARY || info.project.name !== "desktop",
      "Requires the official sing-box binary and a production build; desktop integration fixture.",
    );
    const directory = await mkdtemp(`${tmpdir()}/singdeck-browser-`);
    const secret = randomBytes(24).toString("hex");
    const probe = createServer(serveDiagnostics);
    const udp = createSocket("udp4");
    udp.on("message", (request, remote) => {
      const response = stunBindingResponse(request, remote.port);
      if (response) udp.send(response, remote.port, remote.address);
    });
    let child: ChildProcess | undefined;
    try {
      probe.listen(0, "127.0.0.1");
      udp.bind(0, "127.0.0.1");
      await Promise.all([once(probe, "listening"), once(udp, "listening")]);
      const address = probe.address();
      if (!address || typeof address === "string")
        throw new Error("Missing probe fixture address");
      const config = JSON.parse(
        await readFile("examples/sing-box-1.14.0.json", "utf8"),
      );
      config.dns = stunFixtureDNS;
      config.outbounds.push(
        { type: "direct", tag: "ungrouped" },
        {
          type: "urltest",
          tag: "Auto route",
          outbounds: ["direct", "direct-backup"],
          url: `http://127.0.0.1:${address.port}/probe`,
          interval: "10m",
        },
      );
      if (baseURL)
        config.services[0].access_control_allow_origin.push(new URL(baseURL).origin);
      config.services[0].secret = secret;
      config.services[0].listen_port = 19190;
      config.services[0].dashboard.path = resolve("dist");
      config.inbounds[0].listen_port = 19180;
      await writeFile(`${directory}/config.json`, JSON.stringify(config), {
        mode: 0o600,
      });
      child = spawn(
        process.env.SING_BOX_BINARY!,
        ["run", "-c", `${directory}/config.json`],
        { stdio: "ignore" },
      );
      await expect
        .poll(async () => {
          try {
            return (await fetch("http://127.0.0.1:19190/dashboard/")).ok;
          } catch {
            return false;
          }
        })
        .toBe(true);
      await use({ secret, httpPort: address.port, stunServer: `${stunFixtureHost}:${udp.address().port}` });
    } finally {
      if (child?.pid !== undefined && child.exitCode === null) {
        const daemon = child;
        const exited = new Promise<void>((r) => daemon.once("exit", () => r()));
        child.kill();
        await exited;
      }
      udp.close();
      probe.closeAllConnections();
      await new Promise<void>((closed) => probe.close(() => closed()));
      await rm(directory, { recursive: true, force: true });
    }
  },
});

test.use({ trace: "off" });
test.describe.configure({ mode: "default" });

test("browser completes local network quality and STUN diagnostics through the native service", async ({
  page,
  core: { secret, httpPort, stunServer },
}) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "API endpoint", exact: true }).fill("http://127.0.0.1:19190");
  await page.getByLabel("Bearer token", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Connected$/ })).toBeVisible();
  await page.getByRole("link", { name: "Diagnostics", exact: true }).first().click();
  const run = page.getByRole("button", { name: "Run test", exact: true });
  const completed = page.getByRole("status").filter({ hasText: /^Completed$/ });
  await page.getByLabel("Test configuration URL").fill(`http://127.0.0.1:${httpPort}/config`);
  await page.getByLabel("Measurement duration (seconds)").fill("2");
  await page.getByRole("switch", { name: "Run download and upload in sequence" }).check();
  await expect(run).toBeDisabled();
  await page.getByRole("checkbox", { name: /I authorize the core to fetch/ }).check();
  await run.click();
  await expect(completed).toBeVisible();
  await expect(page.getByText(/^[1-9].*bit\/s$/).first()).toBeVisible();
  await page.getByRole("radio", { name: "STUN / NAT", exact: true }).click();
  await page.getByLabel("STUN server", { exact: true }).fill(stunServer);
  await expect(run).toBeDisabled();
  await page.getByRole("checkbox", { name: /I authorize the core to send UDP/ }).check();
  await run.click();
  await expect(completed).toBeVisible();
  await expect(page.getByText("Binding response received", { exact: true })).toBeVisible();
  await expect(page.getByText("Unavailable on this STUN server", { exact: true })).toBeVisible();
});

test("browser uses the official native service through CORS and built-in dashboard hosting", async ({
  page,
  context,
  core: { secret },
}) => {
  test.setTimeout(120_000);
  try {
    await page.clock.install();
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
    const overviewLink = page
      .getByRole("link", { name: "Overview", exact: true })
      .first();
    const outboundsLink = page
      .getByRole("link", { name: "Outbounds", exact: true })
      .first();
    await outboundsLink.click();
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
    await page.getByRole("radio", { name: "All outbounds", exact: true }).click();
    const inventory = page.getByRole("list", { name: "All outbounds", exact: true });
    await expect(
      inventory.getByRole("listitem").filter({ has: page.getByText("ungrouped", { exact: true }) }),
    ).toContainText("direct");
    await expect(
      inventory.getByRole("listitem").filter({ has: page.getByText("direct-backup", { exact: true }) }),
    ).toContainText("Selected");
    await page.getByRole("radio", { name: "Groups", exact: true }).click();
    const grid = page.locator(".proxy-group-grid");
    const gridTop = (await grid.boundingBox())!.y;
    const testAll = page.getByRole("button", {
      name: "Test all groups",
      exact: true,
      includeHidden: true,
    });
    await testAll.click();
    const toast = page.locator(".latency-toast");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(testAll).toBeEnabled({ timeout: 40_000 });
    await expect(toast).toBeHidden();
    await overviewLink.click();
    await expect(overviewLink).toHaveAttribute("aria-current", "page");
    await page.evaluate(() => {
      Reflect.deleteProperty(document, "hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(toast).toBeHidden();
    await outboundsLink.click();
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Test requests sent.");
    await expect(page.locator(".latency-toast-viewport")).toHaveCSS(
      "position",
      "fixed",
    );
    expect((await grid.boundingBox())!.y).toBe(gridTop);
    const desktop = page.viewportSize()!;
    await page.setViewportSize({ width: 390, height: 720 });
    await page.locator("#main-content").focus();
    await expect(toast).toBeInViewport({ ratio: 1 });
    const navigation = (await page.locator(".mobile-bottom").boundingBox())!;
    const popup = (await toast.boundingBox())!;
    expect(popup.y + popup.height).toBeLessThan(navigation.y);
    await simulateVisualViewport(page, {
      width: 98,
      height: 180,
      offsetLeft: 115,
      offsetTop: 95,
    });
    await expect(toast).toHaveCSS("width", "90px");
    await expect(toast).toBeVisible();
    const raisedPopup = (await toast.boundingBox())!;
    expect(raisedPopup.x).toBeGreaterThan(115);
    expect(raisedPopup.x + raisedPopup.width).toBeLessThan(213);
    expect(raisedPopup.y).toBeGreaterThan(95);
    expect(raisedPopup.y + raisedPopup.height).toBeLessThan(275);
    await page.setViewportSize({ width: 390, height: 640 });
    await simulateVisualViewport(page, {
      width: 98,
      height: 160,
      offsetLeft: 115,
      offsetTop: 480,
    });
    await expect(toast).toBeHidden();
    await page.clock.fastForward(5_000);
    await page.setViewportSize({ width: 844, height: 390 });
    await simulateVisualViewport(page, {
      width: 844,
      height: 210,
      offsetLeft: 0,
      offsetTop: 42,
    });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCSS("bottom", "154px");
    const landscapePopup = (await toast.boundingBox())!;
    expect(landscapePopup.y).toBeGreaterThan(42);
    expect(landscapePopup.y + landscapePopup.height).toBeLessThan(252);
    await page.evaluate(() => {
      const viewport = window.visualViewport!;
      Reflect.deleteProperty(viewport, "width");
      Reflect.deleteProperty(viewport, "height");
      Reflect.deleteProperty(viewport, "offsetLeft");
      Reflect.deleteProperty(viewport, "offsetTop");
      viewport.dispatchEvent(new Event("resize"));
    });
    await page.setViewportSize(desktop);
    await testAll.focus();
    await expect(testAll).toBeFocused();
    await expect(toast).toBeHidden({ timeout: 6500 });
    expect((await grid.boundingBox())!.y).toBe(gridTop);
    await expect(testAll).toBeFocused();
    await page
      .getByRole("button", { name: "Expand Primary route", exact: true })
      .click();
    await testAll.click();
    const openDetails = backup.getByRole("button", {
      name: "Node details for direct-backup",
      exact: true,
    });
    const details = page.getByRole("dialog", { name: "direct-backup" });
    const closeDetails = details.getByRole("button", { name: "Close", exact: true });
    await openDetails.click();
    await expect(details).toBeVisible();
    await expect(testAll).toBeEnabled({ timeout: 40_000 });
    await expect(toast).toBeHidden();
    await closeDetails.click();
    await expect(toast).toBeVisible();
    await openDetails.click();
    await expect(toast).toBeHidden();
    await closeDetails.click();
    await expect(toast).toBeVisible();
    await page.getByRole("button", { name: "Current connection", exact: true }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(toast).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(toast).toBeVisible();
    await page.setViewportSize({ width: 390, height: 720 });
    await page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("link", { name: "Settings", exact: true })
      .focus();
    const tooltip = page.locator('[data-slot="tooltip-content"]').filter({
      hasText: "Instance and dashboard information.",
    });
    await expect(tooltip).toBeVisible();
    await expect.poll(async () => {
      const popup = (await toast.boundingBox())!;
      const hint = (await tooltip.boundingBox())!;
      return popup.y + popup.height <= hint.y || popup.x + popup.width <= hint.x;
    }).toBe(true);
    await expect(toast).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const selectDirect = page.getByRole("button", { name: "Select direct", exact: true });
    const control = (await selectDirect.boundingBox())!;
    await page.setViewportSize({ width: 390, height: Math.ceil(control.y + control.height + 85) });
    await expect.poll(async () => {
      const popup = (await toast.boundingBox())!;
      const button = (await selectDirect.boundingBox())!;
      return popup.y < button.y + button.height && popup.y + popup.height > button.y;
    }).toBe(true);
    await page.keyboard.press("Tab");
    await selectDirect.focus();
    await expect.poll(async () => {
      const popup = (await toast.boundingBox())!;
      const button = (await selectDirect.boundingBox())!;
      return popup.y + popup.height <= button.y;
    }).toBe(true);
    await expect(toast).toBeVisible();
    await page.setViewportSize(desktop);
    await overviewLink.click();
    await expect(toast).toBeHidden({ timeout: 1000 });
    await outboundsLink.click();
    await expect(grid).toBeVisible();
    await expect(toast).toBeHidden();
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
    await page.evaluate(() => {
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = (name, version) => {
        const request = open(name, version);
        Object.defineProperty(request, "onsuccess", { set() {} });
        return request;
      };
    });
    await remember.click();
    await page.getByLabel("Bearer token", { exact: true }).fill(secret);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Logs", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/^Could not remember this connection/),
    ).toBeVisible();
    await page.reload();
    await expect(remember).toBeEnabled();
    await expect(remember).not.toBeChecked();

    const refuseConfirmation = () => {
      const marker = "singdeck.remembered-connection";
      const tracked = (key: string) =>
        key === marker || key.startsWith(marker + ".");
      const used = () =>
        Object.keys(localStorage)
          .filter(tracked)
          .reduce(
            (size, key) =>
              size + key.length + (localStorage.getItem(key)?.length ?? 0),
            0,
          );
      const capacity = used();
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        const previous = localStorage.getItem(key);
        const growth =
          previous === null
            ? key.length + value.length
            : value.length - previous.length;
        if (
          (key === marker && value.startsWith("+")) ||
          (tracked(key) && used() + growth > capacity)
        ) {
          throw new DOMException(
            "Confirmation unavailable",
            "QuotaExceededError",
          );
        }
        setItem.call(this, key, value);
      };
    };
    await page.evaluate(refuseConfirmation);
    await page.addInitScript(refuseConfirmation);
    await page.evaluate(() => {
      const open = indexedDB.open.bind(indexedDB);
      let pauseCleanup = true;
      indexedDB.open = (name, version) => {
        const request = open(name, version);
        if (pauseCleanup) {
          pauseCleanup = false;
          Object.defineProperty(request, "onsuccess", { set() {} });
        }
        return request;
      };

      let deadline: AbortController | undefined;
      const timeout = AbortSignal.timeout.bind(AbortSignal);
      AbortSignal.timeout = (milliseconds) => {
        const controller = new AbortController();
        const original = timeout(milliseconds);
        original.addEventListener(
          "abort",
          () => controller.abort(original.reason),
          { once: true },
        );
        deadline = controller;
        return controller.signal;
      };
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        document.documentElement.dataset.selectionBeforeWrite =
          localStorage.getItem("singdeck.remembered-connection")?.[0];
        const request = put.call(this, value, key);
        const writeDeadline = deadline;
        this.transaction.addEventListener(
          "complete",
          () => writeDeadline?.abort(),
          { once: true },
        );
        return request;
      };
    });
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
    await expect(page.locator("html")).toHaveAttribute(
      "data-selection-before-write",
      "~",
    );
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
    const originalProfiles = await page.evaluate(
      (key) => localStorage.getItem(key)!,
      profilesKey,
    );
    const endpointChange = await context.newPage();
    await endpointChange.addInitScript((key) => {
      const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
      crypto.subtle.decrypt = (...args) => {
        const profiles = JSON.parse(localStorage.getItem(key)!);
        const duplicate = {
          ...profiles[0],
          endpoint: "http://127.0.0.1:19999",
        };
        localStorage.setItem(key, JSON.stringify([duplicate, ...profiles]));
        return decrypt(...args);
      };
    }, profilesKey);
    await endpointChange.goto(logsUrl);
    await expect(
      endpointChange.getByRole("button", { name: "Connect", exact: true }),
    ).toBeEnabled();
    await expect(
      endpointChange.getByLabel("API endpoint", { exact: true }),
    ).toHaveValue("http://127.0.0.1:19999");
    await expect(
      endpointChange.getByLabel("Bearer token", { exact: true }),
    ).toHaveValue("");
    await expect(
      endpointChange.getByRole("button", { name: "Forget saved connection" }),
    ).toBeVisible();
    await endpointChange.close();
    await page.evaluate(
      ([key, original]) => localStorage.setItem(key, original),
      [profilesKey, originalProfiles],
    );

    const missingProfile = await context.newPage();
    await missingProfile.addInitScript(
      (key) => localStorage.removeItem(key),
      profilesKey,
    );
    let restoredWithoutProfile = false;
    await missingProfile.route(
      "**/daemon.StartedService/GetVersion",
      (route) => {
        restoredWithoutProfile = true;
        return route.abort();
      },
    );
    await missingProfile.goto(logsUrl);
    await expect(
      missingProfile.getByText(/^Could not restore the saved connection/),
    ).toBeVisible();
    expect(restoredWithoutProfile).toBe(false);
    await missingProfile.close();
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
    ).not.toMatch(/[+?~]/);
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
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = (name, version) => {
        const request = open(name, version);
        Object.defineProperty(request, "onsuccess", { set() {} });
        return request;
      };
    });
    const unlock = await holdConnectionLock(reopened, markerKey);
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
      reopened.getByText(/^Could not forget the saved connection/),
    ).toBeVisible();
    await unlock.evaluate((release) => release());
    await unlock.dispose();
    await reopened
      .getByRole("button", { name: "Forget saved connection" })
      .click();
    const tokenInput = reopened.getByLabel("Bearer token", { exact: true });
    await expect(tokenInput).toBeVisible();
    await expect(
      reopened.getByText(/^Could not forget the saved connection/),
    ).toBeVisible();
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
    await expect(
      reopened.getByRole("button", { name: "Connect", exact: true }),
    ).toBeEnabled();
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
    const rejectedId = await reopened.evaluate(
      (key) => localStorage.getItem(key)!.slice(1),
      markerKey,
    );
    expect(
      await reopened.evaluate(
        (key) => localStorage.getItem(key),
        `${markerKey}.revoked.${rejectedId}`,
      ),
    ).toBe("0");
    const lockPeer = await context.newPage();
    await lockPeer.goto(
      "http://127.0.0.1:19190/dashboard/third-party-licenses.txt",
    );
    let releaseRejection!: () => Promise<void>;
    await reopened.route(versionRpc, async (route) => {
      const lock = await holdConnectionLock(lockPeer, markerKey);
      releaseRejection = async () => {
        await lock.evaluate((release) => release());
        await lock.dispose();
      };
      await route.fulfill({ status: 401 });
    });
    await reopened.reload();
    await expect(reopened.getByText(/^Authentication failed/)).toBeVisible();
    await expect(tokenInput).toHaveValue("");
    await reopened.unroute(versionRpc);
    await reopened.reload();
    await expect(
      reopened.getByRole("button", { name: "Connect", exact: true }),
    ).toBeEnabled();
    await expect(reopened.getByRole("navigation")).toHaveCount(0);
    expect(
      await reopened.evaluate(
        (key) => localStorage.getItem(key),
        `${markerKey}.revoked.${rejectedId}`,
      ),
    ).toBe("1");
    await releaseRejection();
    await lockPeer.close();

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
      let startupReads = 0;
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = (name, version) => {
        const request = open(name, version);
        if (startupReads++ < 2)
          Object.defineProperty(request, "onsuccess", { set() {} });
        return request;
      };
    });
    await newer.goto(logsUrl);
    await newer.getByRole("button", { name: "Cancel connection" }).click();
    await expect(
      newer.getByRole("button", { name: "Connect", exact: true }),
    ).toBeEnabled();
    await expect(
      newer.getByRole("button", { name: "Forget saved connection" }),
    ).toBeVisible();
    expect(
      await newer.evaluate((key) => localStorage.getItem(key)?.[0], markerKey),
    ).toBe("?");
    await newer.reload();
    await newer
      .getByRole("button", { name: "Forget saved connection" })
      .click();
    await expect(
      newer.getByRole("button", { name: "Connect", exact: true }),
    ).toBeEnabled();
    expect(
      await newer.evaluate(
        (key) => localStorage.getItem(key)?.[0] ?? "",
        markerKey,
      ),
    ).not.toMatch(/[+?~]/);
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
    await expect(
      reopened.getByText(/^The saved connection changed/),
    ).toBeVisible();
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

    await reopened.evaluate((key) => localStorage.removeItem(key), markerKey);
    const optedOut = await context.newPage();
    await optedOut.goto(logsUrl);
    await optedOut.evaluate(() => {
      const timeout = AbortSignal.timeout.bind(AbortSignal);
      AbortSignal.timeout = (delay) => timeout(delay === 3000 ? 60_000 : delay);
    });
    const pendingClaim = await holdConnectionLock(reopened, markerKey);
    const claimQueued = () =>
      optedOut.evaluate(async (key) => {
        const { pending } = await navigator.locks.query();
        return pending?.some((lock) => lock.name === key) ?? false;
      }, markerKey);
    await optedOut.route(versionRpc, () => {});
    await optedOut.getByLabel("Bearer token", { exact: true }).fill(secret);
    await optedOut
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    const cancelOptOut = optedOut.getByRole("button", {
      name: "Cancel connection",
    });
    await expect(cancelOptOut).toBeVisible();
    await expect.poll(claimQueued).toBe(true);
    await reopened.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [markerKey, replacement],
    );
    await cancelOptOut.click();
    await expect.poll(claimQueued).toBe(false);
    await pendingClaim.evaluate((release) => release());
    await pendingClaim.dispose();
    expect(
      await optedOut.evaluate(
        (key) => navigator.locks.request(key, () => localStorage.getItem(key)),
        markerKey,
      ),
    ).toBe(replacement);
  } finally {
    for (const tab of context.pages()) {
      await tab
        .locator('input[type="password"]')
        .evaluateAll((inputs) => {
          for (const input of inputs) (input as HTMLInputElement).value = "";
        })
        .catch(() => {});
    }
  }
});
