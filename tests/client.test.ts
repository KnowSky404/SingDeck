import { describe, expect, it } from "vitest";
import { create, toBinary } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { createNativeClient, validateEndpoint } from "@/api/client";
import { describeError } from "@/api/errors";
import { inferDefaultEndpoint } from "@/features/instances/profiles";
import { VersionSchema, StatusSchema } from "@/proto/daemon/started_service_pb";

function frame(bytes: Uint8Array, flag = 0) {
  const out = new Uint8Array(bytes.length + 5);
  out[0] = flag;
  new DataView(out.buffer).setUint32(1, bytes.length);
  out.set(bytes, 5);
  return out;
}
function response(data: Uint8Array, status = 0) {
  const trailer = frame(
    new TextEncoder().encode(`grpc-status: ${status}\r\n`),
    128,
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(data.slice(0, 3));
        controller.enqueue(data.slice(3));
        controller.enqueue(trailer);
        controller.close();
      },
    }),
    { headers: { "content-type": "application/grpc-web+proto" } },
  );
}
describe("real gRPC-Web adapter", () => {
  it("infers only valid built-in API origins so every hosting URL can load the entry", () => {
    for (const [url, expected] of [
      ["https://knowsky404.github.io/SingDeck/", "http://127.0.0.1:9090"],
      ["http://127.0.0.1:9091/dashboard/", "http://127.0.0.1:9091"],
      ["https://api.example.org/dashboard/", "https://api.example.org"],
      ["http://192.168.1.20:9090/dashboard/", "http://127.0.0.1:9090"],
    ]) {
      const endpoint = inferDefaultEndpoint(new URL(url));
      expect(endpoint).toBe(expected);
      expect(() => createNativeClient(endpoint, "")).not.toThrow();
    }
    expect(inferDefaultEndpoint()).toBe("http://127.0.0.1:9090");
  });
  it("uses generated descriptors, binary framing, Bearer metadata, deadlines and safe fetch options", async () => {
    let url = "",
      init: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, options) => {
      url = String(input);
      init = options;
      return response(
        frame(
          toBinary(
            VersionSchema,
            create(VersionSchema, { version: "1.14.0", apiVersion: 4 }),
          ),
        ),
      );
    };
    const result = await createNativeClient(
      "https://api.example.org",
      "secret",
      fetcher,
    ).getVersion({});
    expect(result.apiVersion).toBe(4);
    expect(url).toBe(
      "https://api.example.org/daemon.StartedService/GetVersion",
    );
    expect(url).not.toContain("secret");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer secret",
    );
    expect(new Headers(init?.headers).get("grpc-timeout")).toBeTruthy();
    expect(init).toMatchObject({
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
  });
  it("decodes server-streamed protobuf messages across chunk boundaries", async () => {
    const client = createNativeClient("https://api.example.org", "", async () =>
      response(
        frame(
          toBinary(
            StatusSchema,
            create(StatusSchema, { memory: 1234n, trafficAvailable: true }),
          ),
        ),
      ),
    );
    const values = [];
    for await (const value of client.subscribeStatus({
      interval: 1_000_000_000n,
    }))
      values.push(value);
    expect(values[0].memory).toBe(1234n);
  });
  it("decodes gRPC error trailers and never displays server-echoed credentials", async () => {
    const client = createNativeClient(
      "https://api.example.org",
      "secret",
      async () => response(new Uint8Array(), 16),
    );
    await expect(client.getVersion({})).rejects.toMatchObject({
      code: Code.Unauthenticated,
    });
    expect(
      describeError(new ConnectError("echo secret", Code.Internal)),
    ).not.toContain("secret");
  });
  it("rejects credential URLs, insecure remote endpoints and non-HTTP schemes", () => {
    for (const endpoint of [
      "ftp://host",
      "https://user:pass@host",
      "https://host/?token=secret",
      "https://host/#secret",
      "http://remote.example",
    ])
      expect(() => validateEndpoint(endpoint)).toThrow();
    expect(validateEndpoint("http://127.0.0.1:9090/")).toBe(
      "http://127.0.0.1:9090",
    );
    expect(validateEndpoint("https://host/prefix/")).toBe(
      "https://host/prefix",
    );
  });
});
