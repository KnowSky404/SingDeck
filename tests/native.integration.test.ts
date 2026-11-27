import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import {
  createServer,
  request,
  type Server,
  type ClientRequest,
} from "node:http";
import { createNativeClient, type SingBoxClient } from "@/api/client";
import { Code } from "@connectrpc/connect";
import {
  ServiceStatus_Type,
  type ConnectionEvent,
} from "@/proto/daemon/started_service_pb";
import { InstanceSession } from "@/api/session";
import { defaultProfile } from "@/features/instances/profiles";

function first<T>(stream: AsyncIterable<T>) {
  return stream[Symbol.asyncIterator]().next();
}

const binary = process.env.SING_BOX_BINARY;
const suite = binary ? describe : describe.skip;
suite("official sing-box 1.14.0 native integration (not mock)", () => {
  let child: ChildProcess,
    directory: string,
    client: SingBoxClient,
    endpoint: string,
    secret: string;
  let target: Server, proxyRequest: ClientRequest | undefined;
  let cliDeprecationReported = false;
  const scopes: AbortController[] = [];
  const scope = () => {
    const c = new AbortController();
    scopes.push(c);
    return c;
  };
  beforeAll(async () => {
    directory = await mkdtemp(`${tmpdir()}/singdeck-native-`);
    secret = randomBytes(24).toString("hex");
    endpoint = "http://127.0.0.1:19090";
    target = createServer((req, response) => {
      if (req.url === "/probe") {
        response.writeHead(204);
        response.end();
      } else {
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.write("local integration traffic\n");
      }
    });
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
    const address = target.address();
    if (!address || typeof address === "string")
      throw new Error("Missing fixture address");
    const config = JSON.parse(
      await readFile("examples/sing-box-1.14.0.json", "utf8"),
    );
    config.dns = { independent_cache: true };
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
    config.services[0].secret = secret;
    config.services[0].dashboard.path = resolve("dist");
    const path = `${directory}/config.json`;
    await writeFile(path, JSON.stringify(config), { mode: 0o600 });
    expect(spawnSync(binary!, ["check", "-c", path]).status).toBe(0);
    const daemon = spawn(binary!, ["run", "-c", path], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    child = daemon;
    createInterface({ input: daemon.stderr }).on("line", (line) => {
      if (line.includes("`independent_cache` DNS option is deprecated"))
        cliDeprecationReported = true;
    });
    client = createNativeClient(endpoint, secret);
    const deadline = Date.now() + 10000;
    while (true) {
      try {
        await client.getVersion({}, { timeoutMs: 200 });
        break;
      } catch {
        if (Date.now() > deadline || child.exitCode !== null)
          throw new Error("Official sing-box fixture failed to start");
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  });
  afterAll(async () => {
    scopes.forEach((c) => c.abort());
    proxyRequest?.destroy();
    target?.closeAllConnections();
    target?.close();
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((r) => child.once("exit", () => r()));
      child.kill("SIGTERM");
      await exited;
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it("authenticates, reads core/API metadata and streams all P0 channels", async () => {
    expect(await client.getVersion({})).toMatchObject({
      version: "1.14.0",
      apiVersion: 4,
    });
    await expect(
      createNativeClient(endpoint, "invalid").getVersion({}),
    ).rejects.toMatchObject({ code: Code.Unauthenticated });
    expect((await client.getStartedAt({})).startedAt).toBeGreaterThan(0n);
    expect((await client.getDefaultLogLevel({})).level).toBe(4);
    const s = scope();
    const [service, status, groups, log, connections] = await Promise.all([
      first(client.subscribeServiceStatus({}, { signal: s.signal })),
      first(
        client.subscribeStatus(
          { interval: 1_000_000_000n },
          { signal: s.signal },
        ),
      ),
      first(client.subscribeGroups({}, { signal: s.signal })),
      first(client.subscribeLog({}, { signal: s.signal })),
      first(
        client.subscribeConnections(
          { interval: 1_000_000_000n },
          { signal: s.signal },
        ),
      ),
    ]);
    expect(service.value?.status).toBe(ServiceStatus_Type.STARTED);
    expect(status.value?.trafficAvailable).toBe(true);
    expect(groups.value?.group[0].tag).toBe("Primary route");
    expect(log.value?.reset).toBe(true);
    expect(connections.value?.reset).toBe(true);
    s.abort();
  });
  it("streams configured outbounds with their tags and types, including ungrouped entries", async () => {
    const s = scope();
    try {
      const [inventory, groups] = await Promise.all([
        first(client.subscribeOutbounds({}, { signal: s.signal })),
        first(client.subscribeGroups({}, { signal: s.signal })),
      ]);
      if (inventory.done || groups.done)
        throw new Error("Expected an inventory and a group snapshot");
      expect(inventory.value.outbounds).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tag: "ungrouped", type: "direct" }),
          expect.objectContaining({ tag: "Primary route", type: "selector" }),
          expect.objectContaining({ tag: "Auto route", type: "urltest" }),
        ]),
      );
      const groupMembers = groups.value.group.flatMap((group) =>
        group.items.map((item) => item.tag),
      );
      expect(new Set(groupMembers)).toEqual(new Set(["direct", "direct-backup"]));
    } finally {
      s.abort();
    }
  });
  it("returns no collected warnings in CLI mode even when a deprecation is logged", async () => {
    await expect.poll(() => cliDeprecationReported).toBe(true);
    expect((await client.getDeprecatedWarnings({})).warnings).toEqual([]);
  });
  it("confirms a selector switch through the real subscription; receives native RPC errors", async () => {
    const session = new InstanceSession(client, {
      ...defaultProfile,
      endpoint,
    });
    session.connect();
    try {
      await expect
        .poll(() => {
          const { serviceActionsReady, loaded, streamErrors } = session.getSnapshot();
          return serviceActionsReady && loaded.groups && !streamErrors.groups;
        })
        .toBe(true);
      await session.selectOutbound("Primary route", "direct-backup");
      expect(session.getSnapshot().groups?.[0].selected).toBe("direct-backup");
      await expect(
        client.selectOutbound({
          groupTag: "Primary route",
          outboundTag: "absent",
        }),
      ).rejects.toMatchObject({ code: Code.NotFound });
      await client.uRLTest({ outboundTag: "Auto route" });
      await expect
        .poll(() =>
          session
            .getSnapshot()
            .groups?.find((g) => g.tag === "Auto route")
            ?.items.some((item) => item.urlTestTime > 0n),
        )
        .toBe(true);
      await expect(
        client.uRLTest({ outboundTag: "absent" }),
      ).rejects.toMatchObject({ code: Code.NotFound });
      // This config deliberately has no Clash API; native mode RPCs must report absent capability.
      await expect(client.getClashModeStatus({})).rejects.toMatchObject({
        code: Code.NotFound,
      });
      await expect(client.setClashMode({ mode: "rule" })).rejects.toMatchObject(
        { code: Code.NotFound },
      );
    } finally {
      session.disconnect();
    }
  });
  it("tracks local proxy traffic and closes a specific active connection through native RPC", async () => {
    const addr = target.address();
    if (!addr || typeof addr === "string")
      throw new Error("Missing target port");
    await client.selectOutbound({ groupTag: "Primary route", outboundTag: "direct" });
    proxyRequest = request(
      {
        hostname: "127.0.0.1",
        port: 19080,
        path: `http://127.0.0.1:${addr.port}/hold`,
      },
      (response) => response.resume(),
    );
    proxyRequest.on("error", () => {});
    proxyRequest.end();
    const s = scope();
    let active: ConnectionEvent["connection"];
    for await (const batch of client.subscribeConnections(
      { interval: 100_000_000n },
      { signal: s.signal },
    )) {
      const created = batch.events.find(
        (e) =>
          e.connection?.destination === `127.0.0.1:${addr.port}` &&
          e.connection.closedAt === 0n,
      );
      if (created?.connection) {
        active = created.connection;
        break;
      }
    }
    s.abort();
    if (!active) throw new Error("Expected a native connection");
    expect(active).toMatchObject({
      outbound: "direct",
      outboundType: "direct",
      chainList: ["direct", "Primary route"],
      inbound: "mixed-in",
      inboundType: "mixed",
      network: "tcp",
      ipVersion: 4,
    });
    expect(active.createdAt).toBeGreaterThan(0n);
    await client.closeConnection({ id: active.id });
    await client.closeAllConnections({});
    const verify = scope();
    const snapshot = await first(
      client.subscribeConnections(
        { interval: 1_000_000_000n },
        { signal: verify.signal },
      ),
    );
    const closed = snapshot.value?.events.find((e: ConnectionEvent) => e.id === active.id)?.connection;
    expect(closed).toMatchObject({ chainList: active.chainList, createdAt: active.createdAt });
    expect(closed?.closedAt).toBeGreaterThanOrEqual(active.createdAt);
    verify.abort();
  });
  it("serves production assets and hash routes under /dashboard/ and enforces configured CORS", async () => {
    const html = await fetch(`${endpoint}/dashboard/`);
    expect(html.ok).toBe(true);
    const text = await html.text();
    expect(text).toContain("SingDeck");
    const asset = /src="(\.\/assets\/[^"]+)"/.exec(text)?.[1];
    expect(asset).toBeTruthy();
    expect((await fetch(new URL(asset!, `${endpoint}/dashboard/`))).ok).toBe(
      true,
    );
    const allowed = await fetch(
      `${endpoint}/daemon.StartedService/GetVersion`,
      {
        method: "OPTIONS",
        headers: {
          Origin: "http://127.0.0.1:4173",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers":
            "authorization,content-type,x-grpc-web",
        },
      },
    );
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "http://127.0.0.1:4173",
    );
    const denied = await fetch(`${endpoint}/daemon.StartedService/GetVersion`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://untrusted.example",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
});
