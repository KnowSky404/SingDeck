import { Code, ConnectError } from "@connectrpc/connect";
import { describeError } from "./errors";

export const capabilityNames = [
  "trafficTracking",
  "outboundInventory",
  "groupManagement",
  "urlTest",
  "clashMode",
  "networkQuality",
  "stun",
  "deprecatedWarnings",
  "runtimeMonitoring",
  "notifications",
  "tailscale",
  "taildrop",
  "openvpn",
  "openconnect",
  "usbip",
] as const;

export type CapabilityName = (typeof capabilityNames)[number];
export type Capability = {
  status: "unknown" | "supported" | "unavailable" | "error" | "unsupported";
  error?: string;
  code?: Code;
};
export type Capabilities = Record<CapabilityName, Capability>;

export function initialCapabilities(): Capabilities {
  return Object.fromEntries(
    capabilityNames.map((name) => [name, { status: "unknown" }]),
  ) as Capabilities;
}

export function capabilityFailure(error: unknown): Capability {
  const { code } = ConnectError.from(error);
  return {
    status:
      code === Code.Unimplemented
        ? "unsupported"
        : code === Code.NotFound
          ? "unavailable"
          : "error",
    code,
    error: describeError(error),
  };
}
