import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { build, preview, type Plugin } from "vite";
import { CONNECTION_LIMIT } from "../src/api/state";

const port = 15926;
const origin = `http://127.0.0.1:${port}`;
const viewport = { width: 1280, height: 720 };
const pageSize = 50;
const steadyMs = 8_000;
const repetitions = 3;
const fixtureFile = resolve("src/mocks/client.ts");
const benchmarkFiles = ["docs/verification.md", "scripts/measure-connection-capacity.ts"];
type CapacityWindow = { connectionCapacityFixture: { count: number; longTasks: number[] | null } };

function fixturePlugin(): Plugin {
  const replacements = [
    [
      "Array.from({ length: 28 }, (_, i) => {",
      "Array.from({ length: globalThis.connectionCapacityFixture.count - 2 }, (_, i) => {",
    ],
    [
      "createdAt: BigInt(Date.now() - i * 2300),",
      "createdAt: BigInt(Date.now() - i * 2300), closedAt: i % 5 === 4 ? BigInt(Date.now()) : 0n,",
    ],
    ["203.0.113.${i + 1}", "203.0.113.${i % 254 + 1}"],
  ] as const;
  return {
    name: "benchmark-synthetic-connections",
    enforce: "pre",
    transform(source, id) {
      if (id !== fixtureFile) return;
      for (const [before, after] of replacements) {
        assert.equal(source.split(before).length, 2, `Benchmark fixture changed: ${before}`);
        source = source.replace(before, after);
      }
      return source;
    },
  };
}

async function measuredFrame(page: Page, action: () => Promise<void>) {
  const start = performance.now();
  await action();
  await page.evaluate(() => new Promise<void>((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => done())),
  ));
  return Math.round(performance.now() - start);
}

async function sample(browser: Browser, count: number, observeUpdates = false) {
  const context = await browser.newContext({ viewport, locale: "en-US" });
  try {
    const blocked: string[] = [];
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      blocked.push(url.origin);
      return route.abort();
    });
    await context.addInitScript((count) => {
      const tasks = PerformanceObserver.supportedEntryTypes.includes("longtask") ? [] as number[] : null;
      Object.assign(globalThis, { connectionCapacityFixture: { count, longTasks: tasks } });
      if (tasks) {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) tasks.push(entry.duration);
        }).observe({ type: "longtask", buffered: true });
      }
    }, count);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const connectionLink = page.getByRole("link", { name: "Connections", exact: true });
    const explore = page.getByRole("button", { name: "Explore demo", exact: true });
    const rows = page.locator(".connection-table tbody tr");
    const search = page.getByRole("textbox", { name: "Search connections" });
    const active = count - 2 - Math.floor((count - 2) / 5);
    const retained = Math.min(count, CONNECTION_LIMIT);
    const matches = Array.from({ length: count - 2 }, (_, index) => index)
      .filter((index) => index % 4 === 0 && index % 5 !== 4).length;
    async function expectCount(expected: number) {
      await expect(page.getByText(`${expected.toLocaleString("en-US")} matching connections · ${pageSize} rows per page`, {
        exact: true,
      })).toBeVisible({ timeout: 15_000 });
      await expect(rows).toHaveCount(Math.min(expected, pageSize));
    }
    const cdp = await context.newCDPSession(page);
    async function heapUsedMiB() {
      const { usedSize } = await cdp.send("Runtime.getHeapUsage");
      return Math.round(usedSize / (1024 * 1024) * 10) / 10;
    }
    const entryMs = await measuredFrame(page, async () => {
      await page.goto(origin);
      await expect(explore).toBeVisible();
    });
    const demoStartedAt = performance.now();
    await explore.click();
    await expect(page.getByRole("status").filter({ hasText: /^Connected$/ })).toBeVisible();
    const connectedToRowsMs = await measuredFrame(page, async () => {
      await connectionLink.click();
      await expectCount(active);
    });
    const demoToRowsMs = Math.round(performance.now() - demoStartedAt);
    const firstPageHeapMiB = await heapUsedMiB();
    const limited = page.getByText("Display limit reached", { exact: true });
    if (count > CONNECTION_LIMIT) await expect(limited).toBeVisible();
    else await expect(limited).toHaveCount(0);
    const searchMs = await measuredFrame(page, async () => {
      await search.fill("api.github.com");
      await expectCount(matches);
    });
    const clearSearchMs = await measuredFrame(page, async () => {
      await search.clear();
      await expectCount(active);
    });
    const pageTurnMs = await measuredFrame(page, async () => {
      await page.getByRole("button", { name: "Next page" }).click();
      await expect(page.getByText(/^Page 2 \/ /)).toBeVisible();
      await expectCount(active);
    });

    await page.getByRole("combobox", { name: "Status filter" }).click();
    await page.getByRole("option", { name: "Closed", exact: true }).click();
    await expectCount(retained - active);
    await page.getByRole("link", { name: "Diagnostics", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Diagnostics", exact: true })).toBeVisible();
    const returnMs = await measuredFrame(page, async () => {
      await connectionLink.click();
      await expectCount(active);
    });
    const longTasks = await page.evaluate(() =>
      (globalThis as unknown as CapacityWindow).connectionCapacityFixture.longTasks,
    );
    let steady: { beforeHeapMiB: number; afterHeapMiB: number } | undefined;
    if (observeUpdates) {
      const firstUpload = rows.first().locator(".connection-upload");
      const before = (await firstUpload.textContent())!;
      const beforeHeapMiB = await heapUsedMiB();
      await page.waitForTimeout(steadyMs);
      await expect(firstUpload).not.toHaveText(before);
      await expectCount(active);
      steady = { beforeHeapMiB, afterHeapMiB: await heapUsedMiB() };
    }
    assert.deepEqual(blocked, [], "The fixture attempted to contact another origin");
    assert.deepEqual(errors, [], "The dashboard reported a browser error");
    return {
      count, retained, active, closed: retained - active,
      entryMs, demoToRowsMs, connectedToRowsMs, searchMs, clearSearchMs, pageTurnMs, returnMs,
      firstPageHeapMiB, steady,
      longTasks: longTasks && { count: longTasks.length, longestMs: Math.max(0, ...longTasks) },
    };
  } finally {
    await context.close();
  }
}

const source = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const worktreeStatus = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
  encoding: "utf8",
}).trimEnd().split("\n").filter(Boolean);
const unexpectedChanges = worktreeStatus.filter((line) => !benchmarkFiles.includes(line.slice(3)));
assert.deepEqual(unexpectedChanges, [], "Benchmark requires clean application source and configuration");
const benchmarkFileHashes = Object.fromEntries(await Promise.all(benchmarkFiles.map(async (file) =>
  [file, createHash("sha256").update(await readFile(file)).digest("hex")],
)));
const directory = await mkdtemp(join(tmpdir(), "singdeck-connection-capacity-"));
const outDir = join(directory, "dist");
await build({ envFile: false, plugins: [fixturePlugin()], build: { outDir }, logLevel: "error" });
const assets = (await readdir(join(outDir, "assets"))).filter((file) => /\.(js|css)$/.test(file));
let gzipBytes = 0;
for (const file of assets) {
  gzipBytes += gzipSync(await readFile(join(outDir, "assets", file)), { level: 9 }).byteLength;
}
const server = await preview({ build: { outDir }, preview: { host: "127.0.0.1", port, strictPort: true }, logLevel: "error" });
try {
  const browser = await chromium.launch();
  try {
    await sample(browser, 1_000);
    const samples = [];
    for (let run = 0; run < repetitions; run++) {
      for (const count of [1_000, 10_000])
        samples.push(await sample(browser, count, run === 0 && count === 10_000));
    }
    const overflow = await sample(browser, 12_000);
    const report = {
      source,
      worktreeStatus,
      benchmarkFileHashes,
      bun: process.versions.bun,
      platform: process.platform,
      architecture: process.arch,
      logicalCpus: availableParallelism(),
      browser: browser.version(),
      viewport,
      repetitions,
      steadyMs,
      fixtureAssetGzipBytes: gzipBytes,
      samples,
      overflow,
    };
    const reportFile = join(directory, "measurements.json");
    await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
    console.log(reportFile);
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
  await rm(outDir, { recursive: true, force: true });
}
