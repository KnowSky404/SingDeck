import { test as base, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { readFile, readdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { rootCertificates } from "node:tls";
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

test("browser waits for native status before applying a blank default workspace route", async ({
  page,
  core: { secret },
}) => {
  const origin = "http://127.0.0.1:19190";
  const statusURL = `${origin}/daemon.StartedService/SubscribeStatus`;
  const assets = resolve("dist/assets");
  const files = await readdir(assets);
  const overviewPages = await Promise.all(files.filter((name) => /^page-.+\.js$/.test(name)).map(async (name) => ({
    name,
    // All lazy page entries use the same filename prefix. Only Overview defines this chart gradient.
    overview: (await readFile(resolve(assets, name), "utf8")).includes("download-fill"),
  })));
  const overviewFiles = overviewPages.filter(({ overview }) => overview).map(({ name }) => name);
  const chartFiles = files.filter((name) => /^CartesianChart-.+\.js$/.test(name));
  expect(overviewFiles).toHaveLength(1);
  expect(chartFiles).toHaveLength(1);
  const overviewAssets = new Set([...overviewFiles, ...chartFiles].map((name) => `${origin}/dashboard/assets/${name}`));
  const requestedOverviewAssets = new Set<string>();
  page.on("request", (request) => {
    if (overviewAssets.has(request.url())) requestedOverviewAssets.add(request.url());
  });

  await page.addInitScript(() => {
    const changesPreference = new URLSearchParams(location.search).get("route") === "short-lived-preference";
    localStorage.setItem("singdeck.default-workspace-page", changesPreference ? "/" : "/logs");
  });
  const rememberedMarker = () => page.evaluate(() => localStorage.getItem("singdeck.remembered-connection")?.[0] ?? null);

  for (const scenario of [
    { query: "late", initialHash: "", lateHash: "#/connections", hash: "#/connections", heading: "Connections" },
    { query: "short-lived", initialHash: "", lateHash: "", hash: "#/logs", heading: "Logs" },
    { query: "short-lived-preference", initialHash: "", lateHash: "", hash: "#/logs", heading: "Logs" },
    { query: "terminal", initialHash: "", lateHash: "", hash: "#/connections", heading: "Connections" },
    { query: "default", initialHash: "", lateHash: "", hash: "#/logs", heading: "Logs" },
    { query: "remembered", initialHash: "", lateHash: "", hash: "#/logs", heading: "Logs" },
    { query: "short-lived-back", initialHash: "", lateHash: "", hash: "", heading: "Overview" },
    { query: "explicit", initialHash: "#/", lateHash: "", hash: "#/", heading: "Overview" },
  ]) {
    const backDuringRetry = scenario.query === "short-lived-back";
    const changePreference = scenario.query === "short-lived-preference";
    const terminalStatus = scenario.query === "terminal";
    const firstStatusEnds = scenario.query === "short-lived" || backDuringRetry || changePreference || terminalStatus;
    requestedOverviewAssets.clear();
    let statusRequests = 0;
    let releaseInitialStatus!: () => void;
    const holdInitialStatus = new Promise<void>((release) => { releaseInitialStatus = release; });
    let releaseStatus!: () => void;
    const holdStatus = new Promise<void>((release) => { releaseStatus = release; });
    await page.route(statusURL, async (route) => {
      if (++statusRequests === 1 && firstStatusEnds) {
        await holdInitialStatus;
        const trailer = Buffer.from(`grpc-status: ${terminalStatus ? 3 : 0}\r\n`);
        // One empty protobuf Status message followed by EOF or non-retryable InvalidArgument.
        const body = Buffer.concat([Buffer.alloc(5), Buffer.from([0x80, 0, 0, 0, trailer.length]), trailer]);
        await route.fulfill({ contentType: "application/grpc-web+proto", body });
        return;
      }
      await holdStatus;
      await route.continue();
    });

    try {
      const start = `${origin}/dashboard/?route=${scenario.query}`;
      const statusRequest = page.waitForRequest(statusURL);
      await page.goto(start + scenario.initialHash);
      if (scenario.query !== "remembered") {
        if (scenario.query === "default") {
          await page.getByRole("switch", { name: "Remember this device" }).click();
        }
        await page.getByLabel("Bearer token", { exact: true }).fill(secret);
        await page.getByRole("button", { name: "Connect", exact: true }).click();
      }
      await statusRequest;
      await expect(page).toHaveURL(start + scenario.initialHash);
      await expect(page.getByRole("navigation")).toHaveCount(0);
      expect(requestedOverviewAssets.size).toBe(0);

      if (scenario.lateHash) {
        await page.evaluate((hash) => { location.hash = hash; }, scenario.lateHash);
        await expect(page).toHaveURL(start + scenario.lateHash);
      }
      if (firstStatusEnds) {
        const initialResponse = page.waitForResponse(statusURL);
        releaseInitialStatus();
        expect((await initialResponse).status()).toBe(200);
        if (terminalStatus) {
          const notice = page.getByRole("alert").filter({ hasText: "Connection failed" });
          await expect(notice).toBeVisible();
          await expect(notice).toContainText("The instance rejected this request. Check the selected resource.");
        } else {
          await expect(page.getByText("Reconnecting · data may be stale", { exact: true })).toBeVisible();
          await expect.poll(() => statusRequests).toBe(2);
        }
        await expect(page).toHaveURL(start);
        await expect(page.locator('nav a[aria-current="page"]')).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "Overview", exact: true })).toHaveCount(0);
        expect(requestedOverviewAssets.size).toBe(0);

        if (changePreference) {
          const settings = page.getByRole("button", { name: "Display settings", exact: true });
          const picker = page.getByRole("combobox", { name: "Default workspace page", exact: true });
          await settings.click();
          await expect(picker).toHaveText("Overview");
          await picker.click();
          await page.getByRole("option", { name: "Logs", exact: true }).click();
          await expect(picker).toHaveText("Logs");
          await settings.click();
          await expect(page).toHaveURL(start);
          await expect(page.locator('nav a[aria-current="page"]')).toHaveCount(0);
          expect(requestedOverviewAssets.size).toBe(0);
        }

        if (terminalStatus) {
          await page.getByRole("button", { name: "Current connection", exact: true }).click();
          await expect(page.getByRole("menuitem", { name: "Retry", exact: true })).toBeVisible();
          await expect(page.getByRole("menuitem", { name: "Disconnect", exact: true })).toBeVisible();
          await page.keyboard.press("Escape");
        }

        if (backDuringRetry || terminalStatus) {
          await page.getByRole("navigation", { name: "Main navigation", exact: true })
            .getByRole("link", { name: "Connections", exact: true }).click();
          await expect(page).toHaveURL(start + "#/connections");
          await expect(page.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
          expect(requestedOverviewAssets.size).toBe(0);
          if (terminalStatus) {
            expect(statusRequests).toBe(1);
            continue;
          }
          await page.goBack();
          await expect(page).toHaveURL(start);
          await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
          expect(requestedOverviewAssets).toEqual(overviewAssets);
        }
      }

      const statusResponse = page.waitForResponse(statusURL);
      releaseStatus();
      expect((await statusResponse).status()).toBe(200);
      if (backDuringRetry) {
        await expect(page.getByRole("status").filter({ hasText: /^Connected$/ })).toBeVisible();
      }
      await expect(page.getByRole("heading", { name: scenario.heading, exact: true })).toBeVisible();
      await expect(page).toHaveURL(start + scenario.hash);
      expect(requestedOverviewAssets).toEqual(scenario.heading === "Overview" ? overviewAssets : new Set());

      if (scenario.query === "default") await expect.poll(rememberedMarker).toBe("+");
      if (scenario.query === "remembered") {
        await page.getByRole("button", { name: "Current connection", exact: true }).click();
        await page.getByRole("menuitem", { name: "Disconnect", exact: true }).click();
        await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeEnabled();
        await expect.poll(rememberedMarker).toBeNull();
      }
    } finally {
      releaseInitialStatus();
      releaseStatus();
      await page.unroute(statusURL);
    }
  }

  const original = `${origin}/dashboard/?route=back`;
  const overview = page.getByRole("heading", { name: "Overview", exact: true });
  await page.goto(original);
  await page.evaluate(() => history.replaceState({ entry: "blank" }, ""));
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(overview).toBeVisible();
  await expect(page).toHaveURL(original + "#/");
  await page.getByRole("button", { name: "Current connection", exact: true }).click();
  await page.getByRole("menuitem", { name: "Disconnect", exact: true }).click();

  await page.getByLabel("Bearer token", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(overview).toBeVisible();
  await expect(page.getByText("Mock mode", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(original + "#/");
  await page.goBack();
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  ));
  await expect(page).toHaveURL(original);
  await expect(overview).toBeVisible();
  expect(await page.evaluate(() => history.state)).toEqual({ entry: "blank" });
});

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
  const detailRequests = { inventory: 0, connections: 0 };
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    if (path === "/daemon.StartedService/SubscribeOutbounds") detailRequests.inventory++;
    if (path === "/daemon.StartedService/SubscribeConnections") detailRequests.connections++;
  });
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
    await overviewLink.click();
    await page.getByRole("link", { name: "View runtime monitor" }).click();
    const runtime = page.getByRole("main");
    await expect(runtime.getByRole("heading", { name: "Runtime monitor" })).toBeVisible();
    await expect(runtime.getByText("1.14.0", { exact: true })).toBeVisible();
    await expect(runtime.getByRole("row", { name: /^Runtime status\b/ })).toContainText("Live");
    await expect(runtime.getByRole("row", { name: /^Service lifecycle\b/ })).toContainText("Live");
    await expect(runtime.getByText("Service: Running", { exact: true })).toBeVisible();
    const outboundsLink = page
      .getByRole("link", { name: "Outbounds", exact: true })
      .first();
    await outboundsLink.click();
    await page
      .getByRole("button", { name: "Expand Primary route", exact: true })
      .click();
    const collapsePrimary = page.getByRole("button", { name: "Collapse Primary route", exact: true });
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
    expect(detailRequests.inventory).toBe(0);
    const groupConnectionRequests = detailRequests.connections;
    expect(groupConnectionRequests).toBeGreaterThan(0);
    await page.getByRole("radio", { name: "All outbounds", exact: true }).click();
    const inventory = page.getByRole("list", { name: "All outbounds", exact: true });
    await expect(
      inventory.getByRole("listitem").filter({ has: page.getByText("ungrouped", { exact: true }) }),
    ).toContainText("direct");
    await expect(
      inventory.getByRole("listitem").filter({ has: page.getByText("direct-backup", { exact: true }) }),
    ).toContainText("Selected");
    await expect.poll(() => detailRequests).toEqual({ inventory: 1, connections: groupConnectionRequests });
    await page.getByRole("link", { name: "Diagnostics", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Diagnostics", exact: true })).toBeVisible();
    await outboundsLink.click();
    await expect(inventory).toBeVisible();
    expect(detailRequests).toEqual({ inventory: 1, connections: groupConnectionRequests });
    await page.getByRole("radio", { name: "Groups", exact: true }).click();
    await expect.poll(() => detailRequests).toEqual({ inventory: 1, connections: groupConnectionRequests + 1 });
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
    await expect(collapsePrimary).toHaveAttribute("aria-expanded", "true");
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
    await expect(collapsePrimary).toHaveAttribute("aria-expanded", "true");
    const testBackup = backup.getByRole("button", { name: "Test direct-backup in Primary route", exact: true });
    const acknowledged = page.waitForResponse((response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/daemon.StartedService/URLTest",
    );
    await testBackup.click();
    await (await acknowledged).finished();
    await expect(page.getByRole("button", { name: "Test direct in Primary route", exact: true })).toBeEnabled();
    await expect(testBackup).toBeDisabled();
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
    const restoredBoot = reopened.waitForResponse((response) =>
      response.url().endsWith("/daemon.StartedService/GetStartedAt") && response.ok(),
    );
    await reopened.goto(logsUrl);
    await expect(
      reopened.getByRole("heading", { name: "Logs", exact: true }),
    ).toBeVisible();
    expect(await (await restoredBoot).finished()).toBeNull();
    const markerKey = "singdeck.remembered-connection";

    const savedMarker = await reopened.evaluate((key) => localStorage.getItem(key), markerKey);
    expect(savedMarker).toMatch(/^\+/);
    const usbipRpc = "**/daemon.StartedService/SubscribeUSBIPServerStatus";
    await reopened.route(usbipRpc, (route) => route.fulfill({ status: 401 }));
    await reopened.getByRole("link", { name: "Settings", exact: true }).click();
    const confirmedVersion = reopened.waitForResponse((response) =>
      response.url().endsWith("/daemon.StartedService/GetVersion") && response.ok(),
    );
    await reopened.getByRole("link", { name: "USB/IP server status", exact: true }).click();
    await expect(reopened.getByText("USB/IP status interrupted", { exact: true })).toBeVisible();
    expect(await (await confirmedVersion).finished()).toBeNull();
    expect(await reopened.evaluate((key) => localStorage.getItem(key), markerKey)).toBe(savedMarker);
    await reopened.unroute(usbipRpc);
    await reopened.goto(logsUrl);
    await reopened.reload();
    await expect(reopened.getByRole("heading", { name: "Logs", exact: true })).toBeVisible();

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

test("browser switches native VPN status and keeps remembered access after a VPN-only denial", async ({ page }) => {
  const binary = process.env.SING_BOX_BINARY;
  test.skip(!binary, "Requires official sing-box v1.14.0 with OpenConnect and OpenVPN support.");

  const directory = await mkdtemp(`${tmpdir()}/singdeck-vpn-browser-`);
  const config = `${directory}/config.json`;
  const secret = randomBytes(24).toString("hex");
  let core: ChildProcess | undefined;
  let reservation: ChildProcess | undefined;
  try {
    // Hold a bound TCP port without listening so no peer can accept either VPN connection.
    const bound = spawn("python3", ["-c", [
      "import socket, sys",
      "with socket.socket() as s:",
      "    s.bind(('127.0.0.1', 0))",
      "    print(s.getsockname()[1], flush=True)",
      "    sys.stdin.buffer.read(1)",
    ].join("\n")], { stdio: ["pipe", "pipe", "ignore"] });
    reservation = bound;
    const unusedPort = await new Promise<number>((resolvePort, reject) => {
      bound.once("error", (error: NodeJS.ErrnoException) => reject(error.code === "ENOENT"
        ? new Error("The native VPN browser fixture requires Python 3 (python3 on PATH).")
        : error));
      bound.once("exit", () => reject(new Error("VPN fixture port reservation exited")));
      bound.stdout.once("data", (data: Buffer) => resolvePort(Number(data.toString("utf8").trim())));
    });

    // Both userspace clients keep normal TLS verification.
    await writeFile(config, JSON.stringify({
      services: [{
        type: "api", tag: "vpn-fixture", listen: "127.0.0.1", listen_port: 0, secret,
        dashboard: resolve("dist"),
      }],
      endpoints: [
        {
          type: "openconnect", tag: "fixture-openconnect", system: false, no_udp: true,
          server: `https://127.0.0.1:${unusedPort}`,
        },
        {
          type: "openvpn-client", tag: "fixture-openvpn", system: false,
          mode: "tls", network: "tcp", server: "127.0.0.1", server_port: unusedPort,
          tls: { certificate: [rootCertificates[0]], server_name: "127.0.0.1", remote_certificate_tls: "server" },
        },
      ],
    }), { mode: 0o600 });
    core = spawn(resolve(binary!), ["run", "-c", config], { stdio: ["ignore", "ignore", "pipe"], cwd: directory });
    core.once("error", () => {});
    let output = "";
    core.stderr!.setEncoding("utf8").on("data", (chunk: string) => { output = (output + chunk).slice(-2048); });
    const endpoint = () => /service\/api\[vpn-fixture\]: tcp server started at (127\.0\.0\.1:\d+)/.exec(output)?.[1];
    await expect.poll(() => Boolean(endpoint()), { timeout: 5000 }).toBe(true);

    await page.addInitScript(() => {
      const browserFetch = window.fetch.bind(window);
      const interruptions = new Map([
        ["SubscribeStatus", new AbortController()],
        ["SubscribeServiceStatus", new AbortController()],
      ]);
      for (const [method, interruption] of interruptions)
        window.addEventListener(`singdeck-fixture-end-${method}`, () => interruption.abort(), { once: true });
      window.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        const method = url.slice(url.lastIndexOf("/") + 1);
        const interruption = interruptions.get(method);
        if (!interruption) return browserFetch(input, init);
        interruptions.delete(method);
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        return browserFetch(input, { ...init, signal: signal
          ? AbortSignal.any([signal, interruption.signal]) : interruption.signal });
      };
    });
    const calls: string[] = [];
    page.on("request", (request) => {
      const method = /\/(SubscribeOpen(?:Connect|VPN)Status)$/.exec(request.url())?.[1];
      if (method) calls.push(method);
    });
    const origin = `http://${endpoint()}`;
    await page.goto(`${origin}/dashboard/#/settings`);
    await expect(page.getByRole("textbox", { name: "API endpoint", exact: true })).toHaveValue(origin);
    await page.getByRole("switch", { name: "Remember this device" }).click();
    await page.getByLabel("Bearer token", { exact: true }).fill(secret);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    const entry = page.getByRole("link", { name: "VPN endpoint status", exact: true });
    await expect(entry).toBeVisible();
    await expect(entry).not.toBeFocused();
    await page.getByRole("main").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Download dashboard", exact: true })).toBeFocused();
    expect(calls).toEqual([]);

    await entry.press("Enter");
    await expect(page.getByRole("heading", { name: "VPN endpoint status", level: 1 })).toBeFocused();
    const openconnect = page.getByRole("listitem").filter({ hasText: "fixture-openconnect" });
    await expect(openconnect.getByText("Connecting", { exact: true })).toBeVisible();
    expect(calls).toEqual(["SubscribeOpenConnectStatus"]);

    const openconnectCanceled = page.waitForEvent("requestfailed", (request) =>
      request.url().endsWith("/SubscribeOpenConnectStatus"));
    await page.getByRole("link", { name: "OpenVPN", exact: true }).click();
    await openconnectCanceled;
    const openvpn = page.getByRole("listitem").filter({ hasText: "fixture-openvpn" });
    await expect(openvpn.getByText("Connecting", { exact: true })).toBeVisible();
    await expect(openconnect).toHaveCount(0);
    expect(calls).toEqual(["SubscribeOpenConnectStatus", "SubscribeOpenVPNStatus"]);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const openvpnCanceled = page.waitForEvent("requestfailed", (request) =>
      request.url().endsWith("/SubscribeOpenVPNStatus"));
    await page.getByRole("link", { name: "Back to Settings", exact: true }).click();
    await openvpnCanceled;
    await expect(entry).toBeFocused();
    await expect(entry).toBeInViewport({ ratio: 1 });

    const rememberedMarker = () => page.evaluate(() => localStorage.getItem("singdeck.remembered-connection"));
    await expect.poll(rememberedMarker).toMatch(/^\+/);
    const savedMarker = await rememberedMarker();
    const vpnDenial = page.getByText("VPN status access was denied. Check the VPN API access policy.", { exact: true });
    for (const { method, open } of [
      { method: "SubscribeOpenConnectStatus", open: entry },
      { method: "SubscribeOpenVPNStatus", open: page.getByRole("link", { name: "OpenVPN", exact: true }) },
    ]) {
      const url = `${origin}/daemon.StartedService/${method}`;
      await page.route(url, (route) => route.fulfill({ status: 401 }));
      const denied = page.waitForResponse((response) => response.url() === url && response.status() === 401);
      const confirmedVersion = page.waitForResponse((response) =>
        response.url() === `${origin}/daemon.StartedService/GetVersion` && response.ok(),
      );
      await open.click();
      await denied;
      await expect(page.getByText("VPN endpoint status interrupted", { exact: true })).toBeVisible();
      await expect(vpnDenial).toBeVisible();
      await expect(page.getByText(/^Authentication failed/)).toHaveCount(0);
      await expect(openconnect).toHaveCount(0);
      await expect(openvpn).toHaveCount(0);
      expect(await (await confirmedVersion).finished()).toBeNull();
      expect(await rememberedMarker()).toBe(savedMarker);
      await page.unroute(url);
    }
    expect(calls).toEqual([
      "SubscribeOpenConnectStatus", "SubscribeOpenVPNStatus",
      "SubscribeOpenConnectStatus", "SubscribeOpenVPNStatus",
    ]);

    const openvpnStatus = `${origin}/daemon.StartedService/SubscribeOpenVPNStatus`;
    const chooseOpenConnect = page.getByRole("link", { name: "OpenConnect", exact: true });
    const chooseOpenVPN = page.getByRole("link", { name: "OpenVPN", exact: true });
    await chooseOpenConnect.click();
    await expect(openconnect.getByText("Connecting", { exact: true })).toBeVisible();
    let releaseOpenVPN!: () => void;
    const openvpnPending = new Promise<void>((resolve) => { releaseOpenVPN = resolve; });
    await page.route(openvpnStatus, async (route) => {
      await openvpnPending;
      await route.continue();
    }, { times: 1 });
    const reopenedOpenVPN = page.waitForRequest(openvpnStatus);
    try {
      await chooseOpenVPN.click();
      await reopenedOpenVPN;
      await expect(page.getByText("Waiting for VPN endpoint status…", { exact: true })).toBeVisible();
      await expect(vpnDenial).toHaveCount(0);
    } finally {
      releaseOpenVPN();
    }
    await expect(openvpn.getByText("Connecting", { exact: true })).toBeVisible();

    await page.reload();
    await expect(openvpn.getByText("Connecting", { exact: true })).toBeVisible();
    expect(await rememberedMarker()).toBe(savedMarker);

    const runtimeStatus = `${origin}/daemon.StartedService/SubscribeStatus`;
    let runtimeRetryRejected = false;
    await page.route(runtimeStatus, (route) => {
      runtimeRetryRejected = true;
      return route.fulfill({ status: 401 });
    });
    const runtimeRejected = page.waitForResponse((response) => response.url() === runtimeStatus && response.status() === 401);
    const runtimeVersion = page.waitForResponse((response) => runtimeRetryRejected &&
      response.url() === `${origin}/daemon.StartedService/GetVersion` && response.ok());
    await page.evaluate(() => window.dispatchEvent(new Event("singdeck-fixture-end-SubscribeStatus")));
    await runtimeRejected;
    expect(await (await runtimeVersion).finished()).toBeNull();
    await expect(page.getByText("Runtime status access was denied. Check the runtime API access policy.", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Authentication failed/)).toHaveCount(0);
    await expect(openvpn).toHaveCount(0);
    expect(await rememberedMarker()).toBe(savedMarker);
    await page.unroute(runtimeStatus);

    await page.reload();
    await expect(openvpn.getByText("Connecting", { exact: true })).toBeVisible();
    const openconnectStatus = `${origin}/daemon.StartedService/SubscribeOpenConnectStatus`;
    const vpnUnavailable = page.getByText("VPN endpoint status is unavailable on this instance.", { exact: true });
    await page.route(openconnectStatus, (route) => route.fulfill({ status: 404 }), { times: 1 });
    await chooseOpenConnect.click();
    await expect(vpnUnavailable).toBeVisible();

    const serviceStatus = `${origin}/daemon.StartedService/SubscribeServiceStatus`;
    const priorVpnRequests = calls.length;
    let serviceRetryRejected = false;
    await page.route(serviceStatus, (route) => {
      serviceRetryRejected = true;
      return route.fulfill({ status: 401 });
    }, { times: 1 });
    const deniedService = page.waitForResponse((response) => response.url() === serviceStatus && response.status() === 401);
    const serviceVersion = page.waitForResponse((response) => serviceRetryRejected &&
      response.url() === `${origin}/daemon.StartedService/GetVersion` && response.ok());
    await page.evaluate(() => window.dispatchEvent(new Event("singdeck-fixture-end-SubscribeServiceStatus")));
    await deniedService;
    expect(await (await serviceVersion).finished()).toBeNull();
    const serviceDenial = page.getByText("Service status access was denied. Check the service API access policy.", { exact: true });
    await expect(serviceDenial).toBeVisible();
    await expect(vpnUnavailable).toHaveCount(0);
    await chooseOpenVPN.click();
    await expect(serviceDenial).toBeVisible();
    await chooseOpenConnect.click();
    await expect(serviceDenial).toBeVisible();
    await expect(vpnUnavailable).toHaveCount(0);
    await expect(vpnDenial).toHaveCount(0);
    await expect(page.getByText(/^Authentication failed/)).toHaveCount(0);
    expect(calls).toHaveLength(priorVpnRequests);
    expect(await rememberedMarker()).toBe(savedMarker);
  } finally {
    if (core?.pid && core.exitCode === null && core.signalCode === null) {
      const exited = once(core, "exit");
      core.kill();
      await exited;
    }
    if (reservation?.pid && reservation.exitCode === null && reservation.signalCode === null) {
      const exited = once(reservation, "exit");
      reservation.stdin!.end();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
