import { create } from "@bufbuild/protobuf";
import { expect, it } from "vitest";
import { InstanceSession } from "@/api/session";
import { serializeConnectionExport } from "@/features/connections/export";
import { mockProfile } from "@/features/instances/profiles";
import { createMockClient } from "@/mocks/client";
import { ConnectionSchema } from "@/proto/daemon/started_service_pb";

it("exports exact counters and only allowlisted, redacted connection metadata", () => {
  const marker = "synthetic-redaction-marker";
  const redact = (value: string) => value.replaceAll(marker, "[redacted]");
  const exportedAt = new Date("2025-01-02T03:04:05Z");
  const row = {
    ...create(ConnectionSchema, {
      id: "closed",
      domain: `${marker}.example`,
      source: "127.0.0.1:4000",
      ipVersion: 6,
      chainList: [marker, "group"],
      processInfo: {
        processId: 10,
        userId: 0,
        userName: marker,
        processPath: `/apps/${marker}`,
        packageNames: [`pkg.${marker}`],
      },
      createdAt: 1_735_786_000_000n,
      closedAt: 1_735_786_050_000n,
      uplinkTotal: 9_007_199_254_740_993n,
      downlinkTotal: 0n,
    }),
    unlistedField: "not-allowlisted",
  };
  const active = create(ConnectionSchema, { id: "active", ipVersion: 0 });
  const report = serializeConnectionExport([row, active], "native", exportedAt, true, redact);
  expect(report).not.toContain(marker);
  expect(report).not.toContain(row.unlistedField);
  expect(JSON.parse(report)).toMatchObject({
    source: "native",
    exportedAt: exportedAt.toISOString(),
    scope: "retained-matching-connections",
    snapshotCurrent: true,
    retentionLimitReached: true,
    units: { timestamps: "unix-ms", traffic: "bytes" },
    chainOrder: "leaf-first",
    connections: [
      {
        id: "closed",
        domain: "[redacted].example",
        ipVersion: 6,
        chainList: ["[redacted]", "group"],
        processInfo: {
          processId: 10,
          userId: 0,
          userName: "[redacted]",
          processPath: "/apps/[redacted]",
          packageNames: ["pkg.[redacted]"],
        },
        createdAt: "1735786000000",
        closedAt: "1735786050000",
        uplinkTotal: "9007199254740993",
        downlinkTotal: "0",
      },
      {
        id: "active",
        domain: null,
        ipVersion: null,
        chainList: [],
        processInfo: null,
        createdAt: null,
        closedAt: null,
        uplinkTotal: "0",
      },
    ],
  });
});

it("redacts percent-encoded credentials even within malformed native text", () => {
  const marker = "sample+&:密";
  const encoded = new TextEncoder().encode(marker).reduce((result, byte, index) => {
    const hex = byte.toString(16).padStart(2, "0");
    return `${result}%${index % 2 ? hex.toUpperCase() : hex}`;
  }, "");
  const partiallyEncoded = encoded.replace(/%2b/i, "+");
  const preserved = "literal%20note%g1+&";
  const row = create(ConnectionSchema, {
    source: `before%g1%ff&+${partiallyEncoded}%`,
    rule: preserved,
    chainList: [encoded, preserved],
    processInfo: { processPath: `/apps/${encoded.toLowerCase()}`, packageNames: [encoded] },
  });
  const report = serializeConnectionExport(
    [row],
    "native",
    new Date(0),
    false,
    (value) => value.replaceAll(marker, "[redacted]"),
  );
  expect(report).not.toContain(marker);
  expect(report).not.toContain(encoded);
  expect(report).not.toContain(encoded.toLowerCase());
  expect(JSON.parse(report).connections[0]).toMatchObject({
    source: "[redacted]",
    rule: preserved,
    chainList: ["[redacted]", preserved],
    processInfo: {
      processPath: "[redacted]",
      packageNames: ["[redacted]"],
    },
  });
});

it("keeps the effective credential and its nested encodings out of the file", () => {
  const marker = "synthetic value/marker";
  const pasted = `${marker}\t `;
  const session = new InstanceSession(createMockClient(), mockProfile, pasted);
  const row = create(ConnectionSchema, {
    outbound: marker,
    source: pasted,
    rule: "literal=synthetic+value/marker",
    inbound: "synthetic%2520value%252Fmarker",
    processInfo: { processPath: "apps/synthetic%2520value%252fmarker" },
  });
  const report = serializeConnectionExport(
    [row],
    "native",
    new Date(0),
    false,
    (value) => session.redactText(value),
  );
  expect(JSON.parse(report).connections[0]).toMatchObject({
    outbound: "[redacted]",
    source: "[redacted]\t ",
    rule: "[redacted]",
    inbound: "[redacted]",
    processInfo: { processPath: "[redacted]" },
  });
});

it("exports every matching retained row past the first page", () => {
  const rows = Array.from({ length: 51 }, (_, index) =>
    create(ConnectionSchema, { id: `row-${index + 1}` }),
  );
  const report = serializeConnectionExport(rows, "mock", new Date(0), false, (value) => value);
  expect(JSON.parse(report).connections.map(({ id }: { id: string }) => id))
    .toEqual(rows.map(({ id }) => id));
});
