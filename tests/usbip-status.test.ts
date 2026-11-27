import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { delay } from "@/api/errors";
import { InstanceSession } from "@/api/session";
import { initialSnapshot, type Snapshot } from "@/api/state";
import { WorkspaceContext, type Workspace } from "@/app/context";
import { defaultProfile } from "@/features/instances/profiles";
import USBIPStatus from "@/features/settings/usbip";
import { translate } from "@/lib/i18n";
import { createMockClient } from "@/mocks/client";
import {
  ServiceStatusSchema,
  ServiceStatus_Type,
  USBIPServerStatusUpdateSchema,
} from "@/proto/daemon/started_service_pb";

const noop = () => undefined;
const workspace: Workspace = {
  profile: defaultProfile,
  profiles: [defaultProfile],
  session: new InstanceSession(createMockClient(), defaultProfile),
  snapshot: initialSnapshot(),
  theme: "system",
  language: "en",
  t: translate("en"),
  setTheme: noop,
  setLanguage: noop,
  selectProfile: noop,
  saveProfile: noop,
  connect: noop,
  disconnect: noop,
  forgetSavedConnection: noop,
  token: "",
  restoring: false,
  disconnecting: false,
  restoredConnection: false,
  remembering: false,
};

function renderStatus(snapshot: Snapshot) {
  return renderToStaticMarkup(createElement(WorkspaceContext.Provider, {
    value: { ...workspace, snapshot },
  }, createElement(USBIPStatus)));
}

it.each([
  [ServiceStatus_Type.IDLE, "The core service is stopped. Start it to view USB/IP status."],
  [ServiceStatus_Type.FATAL, "The service reported a fatal error. Inspect the instance locally."],
])("shows unavailable USB/IP status when the API is connected and the service is %s", (status, expected) => {
  const service = create(ServiceStatusSchema, { status, errorMessage: "untrusted lifecycle detail" });
  const snapshot = { ...initialSnapshot(), phase: "connected", service } as const;
  const html = renderStatus(snapshot);

  expect(html).toContain(expected);
  expect(html).not.toContain("Waiting for USB/IP status…");
  expect(html).not.toContain("untrusted lifecycle detail");
});

it.each([false, true])("stops USB/IP detail when metadata revalidation fails (initial frame received: %s)", async (received) => {
  vi.useFakeTimers();
  const client = createMockClient();
  let failValidation!: () => void;
  const validation = new Promise<void>((resolve) => { failValidation = resolve; });
  const getVersion = vi.fn(client.getVersion).mockImplementationOnce(client.getVersion)
    .mockImplementation(async () => {
      await validation;
      throw new ConnectError("fixture metadata failure", Code.Unavailable);
    });
  const usbip = vi.fn<typeof client.subscribeUSBIPServerStatus>(async function* (_, options) {
    if (received) yield create(USBIPServerStatusUpdateSchema, { servers: [{ serverTag: "fixture-usb-server" }] });
    await delay(60_000, options!.signal!);
  });
  const session = new InstanceSession(
    { ...client, getVersion, subscribeUSBIPServerStatus: usbip },
    { ...defaultProfile, preferences: { ...defaultProfile.preferences, autoReconnect: false } },
  );
  try {
    session.connect();
    await vi.advanceTimersByTimeAsync(500);
    session.setDetailChannel("usbip");
    await vi.advanceTimersByTimeAsync(200);
    expect(getVersion).toHaveBeenCalledTimes(2);
    expect(usbip).toHaveBeenCalledTimes(1);
    expect(Boolean(session.getSnapshot().usbipServers)).toBe(received);

    failValidation();
    await vi.advanceTimersByTimeAsync(200);
    const snapshot = session.getSnapshot();
    expect(snapshot).toMatchObject({ phase: "error", loaded: { status: true, usbip: false } });
    expect(snapshot.streamErrors.usbip).toBeUndefined();
    expect(snapshot.usbipServers).toBeUndefined();
    expect(usbip.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);

    const html = renderStatus(snapshot);
    expect(html).toContain("Reconnect to the core to view USB/IP status.");
    expect(html).not.toContain("fixture-usb-server");
    expect(html).not.toContain("Waiting for USB/IP status…");
    session.setDetailChannel("connections");
    session.setDetailChannel("usbip");
    await vi.advanceTimersByTimeAsync(200);
    expect(usbip).toHaveBeenCalledTimes(1);
  } finally {
    session.disconnect();
    vi.useRealTimers();
  }
});
