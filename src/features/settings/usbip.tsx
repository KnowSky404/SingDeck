import { useEffect, useRef } from "react";
import { useWorkspace } from "@/app/context";
import { Notice, Panel } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { ServiceStatus_Type } from "@/proto/daemon/started_service_pb";

export default function USBIPStatus() {
  const { profile, snapshot, t } = useWorkspace();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  const capability = snapshot.capabilities.usbip.status;
  const error = snapshot.streamErrors.usbip ?? snapshot.streamErrors.service ?? snapshot.streamErrors.status ??
    (snapshot.authenticationFailed
      ? "Authentication failed. Disconnect and check the Bearer token on the entry page."
      : undefined);
  const lifecycle = snapshot.service?.status;
  const servers = snapshot.usbipServers;

  let content;
  if (profile.mode === "mock") {
    content = <p>{t("Connect to a native instance to view USB/IP status.")}</p>;
  } else if (snapshot.phase === "error") {
    content = <p role="status">{t("Reconnect to the core to view USB/IP status.")}</p>;
  } else if (capability === "unavailable" || capability === "unsupported") {
    content = <p role="status">{t("USB/IP status is unavailable on this instance.")}</p>;
  } else if (error) {
    content = <Notice title="USB/IP status interrupted">{t(error)}</Notice>;
  } else if (lifecycle === ServiceStatus_Type.FATAL) {
    content = (
      <Notice title="USB/IP status unavailable">
        The service reported a fatal error. Inspect the instance locally.
      </Notice>
    );
  } else if (lifecycle === ServiceStatus_Type.IDLE) {
    content = <p role="status">{t("The core service is stopped. Start it to view USB/IP status.")}</p>;
  } else if (!servers) {
    content = <p role="status">{t("Waiting for USB/IP status…")}</p>;
  } else if (!servers.length) {
    content = <p role="status">{t("No dynamic USB/IP servers reported.")}</p>;
  } else {
    content = (
      <ul className="divide-y">
        {servers.map(({ tag, deviceCount }, index) => (
          <li key={index} className="py-3">
            <h3 className="font-medium wrap-anywhere">{tag || t("Unnamed server")}</h3>
            <dl className="detail-list">
              <div>
                <dt>{t("Shared devices")}</dt>
                <dd>{deviceCount}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="feature-stack">
      <h1 ref={heading} tabIndex={-1} className="w-fit rounded-sm text-xl font-semibold">{t("USB/IP server status")}</h1>
      <Panel title={<h2>{t("Dynamic USB/IP servers")}</h2>}>
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
