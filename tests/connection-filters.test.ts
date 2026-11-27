import { create } from "@bufbuild/protobuf";
import { expect, it } from "vitest";
import { connectionMatcher, defaultConnectionFilters } from "@/features/connections/filters";
import { ConnectionSchema } from "@/proto/daemon/started_service_pb";

it("intersects native criteria and matches every search word across reported fields", () => {
  const row = create(ConnectionSchema, {
    ipVersion: 6,
    inbound: "Work tunnel",
    outbound: "Office relay",
    network: "tcp",
    protocol: "TLS",
    domain: "example.test",
    rule: "work sites",
    user: "Alice",
    processInfo: {
      processId: 419,
      processPath: "/apps/browser",
      packageNames: ["com.example.browser"],
    },
  });
  const filters = {
    ...defaultConnectionFilters,
    network: "tcp",
    outbound: "Office relay",
    ipVersion: "6",
    inbound: "work TUNNEL",
    protocol: " tls ",
    domain: " Example.Test ",
    rule: " SITES",
    user: "alice",
    process: " 419 ",
  };

  expect(connectionMatcher(filters, "  OFFICE\t example.test  IPv6  com.example.browser ")(row)).toBe(true);
  expect(connectionMatcher(filters, "office missing")(row)).toBe(false);
  expect(connectionMatcher({ ...filters, status: "closed" }, "")(row)).toBe(false);
  expect(connectionMatcher({ ...filters, ipVersion: "4" }, "")(row)).toBe(false);
  expect(connectionMatcher({ ...filters, user: "Bob" }, "")(row)).toBe(false);
});

it("ignores blank criteria and preserves unreported metadata as unknown", () => {
  const row = create(ConnectionSchema, { destination: "[2001:db8::1]:443", processInfo: {} });

  expect(connectionMatcher({ ...defaultConnectionFilters, process: " " }, " \t ")(row)).toBe(true);
  expect(connectionMatcher({ ...defaultConnectionFilters, ipVersion: "6" }, "")(row)).toBe(false);
  expect(connectionMatcher({ ...defaultConnectionFilters, user: "unknown" }, "")(row)).toBe(false);
  expect(connectionMatcher({ ...defaultConnectionFilters, process: "0" }, "")(row)).toBe(false);
  expect(connectionMatcher(defaultConnectionFilters, "ipv6")(row)).toBe(false);
});
