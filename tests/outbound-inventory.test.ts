import { create } from "@bufbuild/protobuf";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { InstanceSession } from "@/api/session";
import { initialSnapshot } from "@/api/state";
import { WorkspaceContext } from "@/app/context";
import { mockProfile } from "@/features/instances/profiles";
import { OutboundInventory } from "@/features/proxies/inventory";
import { translate } from "@/lib/i18n";
import { createMockClient } from "@/mocks/client";
import {
  GroupItemSchema,
  GroupSchema,
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
