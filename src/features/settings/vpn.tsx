import { useEffect, useRef } from "react";
import { authenticationErrorMessage } from "@/api/errors";
import type { VpnProtocol } from "@/api/vpn-status";
import { useWorkspace } from "@/app/context";
import { Notice, Panel } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ServiceStatus_Type } from "@/proto/daemon/started_service_pb";

const protocols = { openconnect: "OpenConnect", openvpn: "OpenVPN" } as const;
const runtimeAccessDenied = "Runtime status access was denied. Check the runtime API access policy.";
const states = {
  connecting: "Connecting",
  "auth-pending": "Authentication pending",
  connected: "Connected",
  error: "Endpoint error",
  unknown: "Unknown",
} as const;

export default function VPNStatus({ protocol }: { protocol: VpnProtocol }) {
  const { profile, snapshot, t } = useWorkspace();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  const capability = snapshot.capabilities[protocol];
  const { streamErrors } = snapshot;
  const runtimeError = streamErrors.status === authenticationErrorMessage
    ? runtimeAccessDenied
    : streamErrors.status;
  const serviceError = streamErrors.service === authenticationErrorMessage
    ? "Service status access was denied. Check the service API access policy."
    : streamErrors.service;
  const prerequisiteError = runtimeError ?? serviceError;
  const currentDetail = snapshot.detailChannel === protocol && snapshot.serviceActionsReady;
  const detailError = currentDetail ? streamErrors[protocol] : undefined;
  const vpnError = detailError === authenticationErrorMessage
    ? "VPN status access was denied. Check the VPN API access policy."
    : detailError;
  const lifecycle = snapshot.service?.status;
  const status = currentDetail ? snapshot.vpnStatus : undefined;

  let content;
  if (profile.mode === "mock") {
    content = <p>{t("Connect to a native instance to view VPN endpoint status.")}</p>;
  } else if (snapshot.authenticationFailed) {
    content = <Notice title="VPN endpoint status interrupted">
      {t(authenticationErrorMessage)}
    </Notice>;
  } else if (prerequisiteError) {
    content = <Notice title="VPN endpoint status interrupted">{t(prerequisiteError)}</Notice>;
  } else if (snapshot.phase === "error") {
    content = <p role="status">{t("Reconnect to the core to view VPN endpoint status.")}</p>;
  } else if (lifecycle === ServiceStatus_Type.FATAL) {
    content = <Notice>{t("The service reported a fatal error. Inspect the instance locally.")}</Notice>;
  } else if (lifecycle === ServiceStatus_Type.IDLE || lifecycle === ServiceStatus_Type.STOPPING) {
    content = <p role="status">{t(lifecycle === ServiceStatus_Type.STOPPING
      ? "Stopping"
      : "The core service is stopped. Start it to view VPN endpoint status.")}</p>;
  } else if (detailError && (capability.status === "unavailable" || capability.status === "unsupported")) {
    content = <p role="status">{t("VPN endpoint status is unavailable on this instance.")}</p>;
  } else if (vpnError) {
    content = <Notice title="VPN endpoint status interrupted">{t(vpnError)}</Notice>;
  } else if (!status) {
    content = <p role="status">{t("Waiting for VPN endpoint status…")}</p>;
  } else if (!status.endpoints.length) {
    content = <p role="status">{t("No VPN endpoints reported.")}</p>;
  } else {
    content = (
      <>
        <ul className="divide-y">
          {status.endpoints.map(({ tag, state }, index) => (
            <li key={index} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <h3 className="min-w-0 font-medium wrap-anywhere">{tag || t("Unnamed endpoint")}</h3>
              <Badge variant="secondary" className="max-w-full whitespace-normal">{t(states[state])}</Badge>
            </li>
          ))}
        </ul>
        {status.truncated && <p className="footnote">{t("Only the first 100 endpoints are shown.")}</p>}
      </>
    );
  }

  return (
    <div className="feature-stack">
      <h1 ref={heading} tabIndex={-1} className="w-fit rounded-sm text-xl font-semibold">{t("VPN endpoint status")}</h1>
      <nav aria-label={t("VPN protocol")} className="button-row">
        {(Object.keys(protocols) as VpnProtocol[]).map((name) => (
          <Button key={name} variant={name === protocol ? "default" : "outline"} asChild>
            <a href={`#/settings/vpn/${name}`} aria-current={name === protocol ? "page" : undefined}>
              {protocols[name]}
            </a>
          </Button>
        ))}
      </nav>
      <Panel title={<h2>{t("{protocol} endpoints", { protocol: protocols[protocol] })}</h2>}>
        {content}
        <div className="button-row">
          <Button variant="outline" asChild>
            <a href="#/settings">{t("Back to Settings")}</a>
          </Button>
        </div>
      </Panel>
    </div>
  );
}
