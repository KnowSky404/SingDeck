import { create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { delay } from "@/api/errors";
import { InstanceSession } from "@/api/session";
import { initialSnapshot } from "@/api/state";
import { WorkspaceContext } from "@/app/context";
import { mockProfile } from "@/features/instances/profiles";
import { OutboundInventory } from "@/features/proxies/inventory";
import { translate } from "@/lib/i18n";
import { createMockClient } from "@/mocks/client";
import {
  GroupItemSchema,
  GroupsSchema,
  GroupSchema,
  OutboundListSchema,
  ServiceStatusSchema,
  ServiceStatus_Type,
} from "@/proto/daemon/started_service_pb";

it("redacts reflected Bearer text from inventory rows, selected members and action labels", () => {
  const reflected = "synthetic-reflected-value";
  const tag = `group-${reflected}`;
  const session = new InstanceSession(createMockClient(), mockProfile, reflected);
  const snapshot = initialSnapshot();
  snapshot.phase = "connected";
  snapshot.loaded.outbounds = true;
  snapshot.service = create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
  snapshot.groups = [create(GroupSchema, { tag, selected: `member-${reflected}` })];
  snapshot.outbounds = [create(GroupItemSchema, { tag, type: `type-${reflected}` })];
  const noop = () => undefined;

  const markup = renderToStaticMarkup(createElement(WorkspaceContext.Provider, {
    value: {
      profile: mockProfile,
      profiles: [mockProfile],
      session,
      snapshot,
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
    },
  }, createElement(OutboundInventory)));

  expect(markup.includes(reflected)).toBe(false);
  expect(markup).toContain("group-[redacted]");
  expect(markup).toContain("type-[redacted]");
  expect(markup).toContain("Selected: member-[redacted]");
  expect(markup).toContain('aria-label="Test group-[redacted]"');
  expect(markup).toContain('aria-label="Group details for group-[redacted]"');
});

it("captures topology already received before the workspace publishes it", async () => {
  const before = create(GroupsSchema, {
    group: [{ tag: "route", items: [{ tag: "leaf", type: "direct", urlTestTime: 1n, urlTestDelay: 10 }] }],
  });
  const updated = create(GroupsSchema, {
    group: [{ tag: "route", items: [{ tag: "leaf", type: "direct", urlTestTime: 1n, urlTestDelay: 18 }] }],
  });
  const client = createMockClient();
  vi.spyOn(client, "subscribeGroups").mockImplementation(async function* (_, options) {
    yield before;
    await delay(350, options!.signal!);
    yield updated;
    await delay(60_000, options!.signal!);
  });
  const session = new InstanceSession(client, mockProfile);
  vi.useFakeTimers();
  try {
    session.setInventoryEnabled(true);
    session.connect();
    await vi.advanceTimersByTimeAsync(350);
    expect(session.getSnapshot().groups).toEqual(before.group);
    const current = session.getOutboundTopology();
    expect(current.groups).toEqual(updated.group);
    expect(current.outbounds).toBeDefined();
  } finally {
    session.disconnect();
    vi.useRealTimers();
  }
});

it("keeps the same topology generation through an isolated inventory retry", async () => {
  const client = createMockClient();
  const inventory = create(OutboundListSchema, { outbounds: [{ tag: "leaf", type: "direct" }] });
  const reads = vi.spyOn(client, "subscribeOutbounds").mockImplementationOnce(async function* (_, options) {
    yield inventory;
    await delay(500, options!.signal!);
    throw new ConnectError("Inventory interrupted", Code.Unavailable);
  });
  const session = new InstanceSession(client, mockProfile);
  vi.useFakeTimers();
  try {
    session.setInventoryEnabled(true);
    session.connect();
    await vi.advanceTimersByTimeAsync(200);
    const { topologyGeneration } = session.getOutboundTopology();
    expect(session.getSnapshot().outbounds).toBeDefined();
    await vi.advanceTimersByTimeAsync(500);
    expect(session.getSnapshot().streamErrors.outbounds).toBeDefined();
    expect(session.getSnapshot().topologyGeneration).toBe(topologyGeneration);
    await vi.advanceTimersByTimeAsync(1000);
    expect(reads).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().streamErrors.outbounds).toBeUndefined();
    expect(session.getSnapshot().topologyGeneration).toBe(topologyGeneration);
  } finally {
    session.disconnect();
    vi.useRealTimers();
  }
});

it("stops queued inventory probes when Groups fails and still allows a standalone probe", async () => {
  const client = createMockClient();
  const tags = Array.from({ length: 11 }, (_, index) => `node-${index}`);
  const inventory = create(OutboundListSchema, {
    outbounds: tags.map((tag) => ({ tag, type: "direct" })),
  });
  vi.spyOn(client, "subscribeOutbounds").mockImplementation(async function* (_, options) {
    yield inventory;
    await delay(60_000, options!.signal!);
  });
  vi.spyOn(client, "subscribeGroups").mockImplementation(async function* (_, options) {
    yield create(GroupsSchema);
    await delay(500, options!.signal!);
    throw new ConnectError("Groups access denied", Code.PermissionDenied);
  });
  const probe = vi.spyOn(client, "uRLTest").mockResolvedValue(create(EmptySchema));
  const session = new InstanceSession(client, { ...mockProfile, mode: "native" });
  vi.useFakeTimers();
  try {
    session.setInventoryEnabled(true);
    session.connect();
    await vi.advanceTimersByTimeAsync(200);
    const batch = session.testInventory(tags, inventory.outbounds);
    const canceled = expect(batch).rejects.toMatchObject({ name: "AbortError" });
    expect(probe).toHaveBeenCalledTimes(10);
    await vi.advanceTimersByTimeAsync(45_750);
    await canceled;
    expect(probe).toHaveBeenCalledTimes(10);
    expect(session.getSnapshot().streamErrors.groups).toBeDefined();
    await expect(session.testInventory(tags, inventory.outbounds)).rejects.toMatchObject({ code: Code.Canceled });
    await expect(session.testLatency(tags[10], 1, "outbounds")).resolves.toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(11);
  } finally {
    session.disconnect();
    vi.useRealTimers();
  }
});

it.each([
  { outcome: "continues", types: ["wireguard", "direct", "direct"], unchanged: true },
  { outcome: "stops", types: ["wireguard", "direct", "wireguard"], unchanged: false },
])("$outcome an inventory test after an inventory with a repeated tag changes", async ({ types, unchanged }) => {
  const inventory = (types: string[], time: bigint) => create(OutboundListSchema, {
    outbounds: [
      ...types.map((type) => ({ tag: "shared", type })),
      { tag: "independent", type: "direct", urlTestTime: time, urlTestDelay: Number(time) },
    ],
  });
  const original = inventory(["direct", "wireguard", "direct"], 1n);
  const updated = inventory(types, 2n);
  const client = createMockClient();
  const probe = vi.spyOn(client, "uRLTest").mockResolvedValue(create(EmptySchema));
  vi.spyOn(client, "subscribeOutbounds").mockImplementation(async function* (_, options) {
    yield original;
    await delay(250, options!.signal!);
    yield updated;
    await delay(60_000, options!.signal!);
  });
  const session = new InstanceSession(client, mockProfile);
  vi.useFakeTimers();
  try {
    session.setInventoryEnabled(true);
    session.connect();
    await vi.advanceTimersByTimeAsync(200);
    expect(session.getSnapshot().outbounds).toEqual(original.outbounds);
    await vi.advanceTimersByTimeAsync(200);
    expect(session.getSnapshot().outbounds).toEqual(updated.outbounds);

    const batch = session.testInventory(["independent"], original.outbounds);
    if (unchanged) {
      await expect(batch).resolves.toBeUndefined();
      expect(probe).toHaveBeenCalledOnce();
      expect(probe.mock.calls[0][0]).toEqual({ outboundTag: "independent" });
    } else {
      await expect(batch).rejects.toMatchObject({ code: Code.Canceled });
      expect(probe).not.toHaveBeenCalled();
    }
  } finally {
    session.disconnect();
    vi.useRealTimers();
  }
});
