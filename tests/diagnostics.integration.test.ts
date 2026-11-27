import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { Code } from "@connectrpc/connect";
import { createNativeClient, type SingBoxClient } from "@/api/client";
import { serveDiagnostics, stunBindingResponse, stunFixtureDNS, stunFixtureHost } from "./fixtures/diagnostics";

const binary = process.env.SING_BOX_BINARY;

async function collect<T>(stream: AsyncIterable<T>) {
  const frames: T[] = [];
  for await (const frame of stream) frames.push(frame);
  return frames;
}

describe.skipIf(!binary)("official sing-box streaming diagnostics", () => {
  let directory: string;
  let child: ChildProcess;
  let client: SingBoxClient;
  let httpBase: string;
  let stunServer: string;
  let heldRequestOpened: (() => void) | undefined;
  let heldRequestClosed: (() => void) | undefined;
  const cancellation = new AbortController();
  const http = createServer((req, res) => {
    if (req.url !== "/hold") {
      serveDiagnostics(req, res);
      return;
    }
    res.once("close", () => heldRequestClosed?.());
    res.writeHead(200);
    res.flushHeaders();
    heldRequestOpened?.();
  });
  const udp = createSocket("udp4");
  udp.on("message", (request, remote) => {
    const response = stunBindingResponse(request, remote.port);
    if (response) udp.send(response, remote.port, remote.address);
  });

  beforeAll(async () => {
    http.listen(0, "127.0.0.1");
    udp.bind(0, "127.0.0.1");
    await Promise.all([once(http, "listening"), once(udp, "listening")]);
    const httpAddress = http.address();
    if (!httpAddress || typeof httpAddress === "string")
      throw new Error("Missing HTTP fixture address");
    httpBase = `http://127.0.0.1:${httpAddress.port}`;
    stunServer = `${stunFixtureHost}:${udp.address().port}`;

    directory = await mkdtemp(`${tmpdir()}/singdeck-diagnostics-`);
    const path = `${directory}/config.json`;
    const secret = randomBytes(24).toString("hex");
    await writeFile(
      path,
      JSON.stringify({
        log: { level: "info" },
        dns: stunFixtureDNS,
        outbounds: [{ type: "direct", tag: "direct" }],
        services: [
          {
            type: "api",
            tag: "diagnostics",
            listen: "127.0.0.1",
            listen_port: 0,
            secret,
          },
        ],
      }),
      { mode: 0o600 },
    );

    child = spawn(binary!, ["run", "-c", path], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let output = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-4096);
    });
    child.once("error", () => {});
    const address = () =>
      /service\/api\[diagnostics\]: tcp server started at (127\.0\.0\.1:\d+)/.exec(output)?.[1];
    const deadline = Date.now() + 5000;
    while (!address()) {
      if (!child.pid || child.exitCode !== null || Date.now() >= deadline)
        throw new Error("Official sing-box diagnostics fixture failed to start");
      await delay(40);
    }
    client = createNativeClient(`http://${address()}`, secret);
    expect(await client.getVersion({})).toMatchObject({
      version: "1.14.0",
      apiVersion: 4,
    });
  });

  afterAll(async () => {
    cancellation.abort();
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    http.closeAllConnections();
    http.close();
    udp.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("completes serial network quality through local HTTP measurement endpoints", async () => {
    const frames = await collect(
      client.startNetworkQualityTest({
        configURL: `${httpBase}/config`,
        serial: true,
        maxRuntimeSeconds: 2,
      }),
    );
    expect([...new Set(frames.map(({ phase }) => phase))]).toEqual([0, 1, 2, 3]);
    expect(frames.some(({ elapsedMs }) => elapsedMs > 0n)).toBe(true);
    expect(frames.at(-1)).toMatchObject({
      phase: 3,
      isFinal: true,
      error: "",
      elapsedMs: 0n,
    });
    expect(frames.at(-1)?.downloadCapacity).toBeGreaterThan(0n);
    expect(frames.at(-1)?.uploadCapacity).toBeGreaterThan(0n);
  });

  it("distinguishes STUN binding success from NAT behavior availability", async () => {
    const frames = await collect(
      client.startSTUNTest({ server: stunServer, outboundTag: "direct" }),
    );
    expect(frames.at(-1)).toMatchObject({
      phase: 3,
      externalAddr: expect.stringMatching(/^127\.0\.0\.1:\d+$/),
      isFinal: true,
      error: "",
      natTypeSupported: false,
      natMapping: 0,
      natFiltering: 0,
    });
    expect(
      frames.some(({ externalAddr, isFinal }) => externalAddr && !isFinal),
    ).toBe(true);
  });

  it.runIf(process.platform === "linux")("streams RFC 5780 mapping and filtering with an alternate address", async () => {
    // Linux routes the full 127/8 loopback range locally.
    const primary = createSocket("udp4");
    const alternate = createSocket("udp4");
    const mapping = createSocket("udp4");
    try {
      primary.bind(0, "127.0.0.1");
      await once(primary, "listening");
      mapping.bind(primary.address().port, "127.0.0.2");
      await once(mapping, "listening");
      alternate.bind(0, "127.0.0.2");
      await once(alternate, "listening");
      for (const socket of [primary, alternate, mapping]) {
        socket.on("message", (request, remote) => {
          const response = stunBindingResponse(request, remote.port, alternate.address().port);
          if (!response) return;
          // A CHANGE-REQUEST with both IP and port flags expects the reply on the alternate address.
          const changeSource = request.length >= 28 && request.readUInt32BE(24) === 6;
          (changeSource ? alternate : socket).send(response, remote.port, remote.address);
        });
      }
      const frames = await collect(client.startSTUNTest({
        server: `${stunFixtureHost}:${primary.address().port}`,
        outboundTag: "direct",
      }, { signal: AbortSignal.timeout(8000) }));
      expect([...new Set(frames.map(({ phase }) => phase))]).toEqual([0, 1, 2, 3]);
      expect(frames.at(-1)).toMatchObject({
        phase: 3,
        isFinal: true,
        error: "",
        natTypeSupported: true,
        natMapping: 2,
        natFiltering: 1,
      });
    } finally {
      primary.close();
      alternate.close();
      mapping.close();
    }
  });

  it("separates an execution error from a missing outbound RPC error", async () => {
    const failed = await collect(
      client.startNetworkQualityTest({ configURL: `${httpBase}/missing` }),
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      isFinal: true,
      error: expect.stringContaining("404"),
    });
    await expect(
      collect(
        client.startSTUNTest({ server: stunServer, outboundTag: "missing" }),
      ),
    ).rejects.toMatchObject({ code: Code.NotFound });
  });

  it("cancels the real stream and the core's pending config fetch", async () => {
    const opened = new Promise<void>((resolve) => {
      heldRequestOpened = resolve;
    });
    const closed = new Promise<void>((resolve) => {
      heldRequestClosed = resolve;
    });
    const stream = collect(
      client.startNetworkQualityTest(
        { configURL: `${httpBase}/hold` },
        { signal: cancellation.signal },
      ),
    );
    const canceled = expect(stream).rejects.toMatchObject({ code: Code.Canceled });
    await opened;
    cancellation.abort();
    await Promise.all([canceled, closed]);
  });
});
