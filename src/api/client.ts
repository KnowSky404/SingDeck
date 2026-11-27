import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";
import { StartedService } from "@/proto/daemon/started_service_pb";

export type SingBoxClient = Pick<
  Client<typeof StartedService>,
  | "getVersion"
  | "subscribeServiceStatus"
  | "subscribeStatus"
  | "subscribeGroups"
  | "subscribeOutbounds"
  | "getDeprecatedWarnings"
  | "startNetworkQualityTest"
  | "startSTUNTest"
  | "selectOutbound"
  | "uRLTest"
  | "subscribeLog"
  | "clearLogs"
  | "getDefaultLogLevel"
  | "subscribeConnections"
  | "closeConnection"
  | "closeAllConnections"
  | "getClashModeStatus"
  | "subscribeClashMode"
  | "setClashMode"
  | "getStartedAt"
>;

export function validateEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a complete HTTP or HTTPS API endpoint.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Use an HTTP(S) endpoint without credentials, query parameters or a fragment.",
    );
  }
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error(
      "Remote instances require HTTPS. Use a loopback SSH tunnel for HTTP.",
    );
  }
  return url.href.replace(/\/+$/, "");
}

export function normalizeBearerToken(token: string): string {
  // Fetch trims HTTP whitespace from the full header value, which starts with "Bearer ".
  let end = token.length;
  while (end > 0 && " \t\n\r".includes(token.charAt(end - 1))) end--;
  return token.slice(0, end);
}

export function createNativeClient(
  endpoint: string,
  token: string,
  customFetch?: typeof globalThis.fetch,
): SingBoxClient {
  const authorization = token ? `Bearer ${normalizeBearerToken(token)}` : undefined;
  const transport = createGrpcWebTransport({
    baseUrl: validateEndpoint(endpoint),
    useBinaryFormat: true,
    interceptors: [
      (next) => (request) => {
        if (authorization) request.header.set("Authorization", authorization);
        return next(request);
      },
    ],
    fetch: (input, init) =>
      (customFetch ?? globalThis.fetch)(input, {
        ...init,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      }),
  });
  const deadlines: Transport = {
    unary: (method, signal, timeoutMs, header, input, context) =>
      transport.unary(
        method,
        signal,
        timeoutMs ?? 10_000,
        header,
        input,
        context,
      ),
    stream: (...args) => transport.stream(...args),
  };
  return createClient(StartedService, deadlines);
}
