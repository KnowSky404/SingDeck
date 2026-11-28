import { safeNativeText } from "./notifications";

export type VpnProtocol = "openconnect" | "openvpn";

export function isVpnProtocol(channel: string): channel is VpnProtocol {
  return channel === "openconnect" || channel === "openvpn";
}

// Both pinned native clients report these states.
const nativeStates = ["connecting", "auth-pending", "connected", "error"] as const;
type VpnState = (typeof nativeStates)[number] | "unknown";
const endpointLimit = 100;

export type VpnStatus = {
  endpoints: { tag: string; state: VpnState }[];
  truncated: boolean;
};

export function projectVpnStatus(
  endpoints: readonly { endpointTag: string; state: string }[],
  redact: (text: string) => string,
): VpnStatus {
  return {
    endpoints: endpoints.slice(0, endpointLimit).map(({ endpointTag, state }) => ({
      tag: safeNativeText(endpointTag, redact, 160),
      state: nativeStates.find((known) => known === state) ?? "unknown",
    })),
    truncated: endpoints.length > endpointLimit,
  };
}
