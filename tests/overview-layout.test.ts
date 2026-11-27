import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultOverviewLayout,
  loadOverviewLayout,
  saveOverviewLayout,
  type OverviewLayout,
} from "@/features/dashboard/overview-layout";

const storageKey = "singdeck.overview-layout";
const alternate: OverviewLayout = {
  metrics: ["memory", "upload", "connections", "download"],
  panels: ["logs", "instance", "outbounds", "traffic"],
};

afterEach(() => vi.unstubAllGlobals());

describe("Overview layout preferences", () => {
  it("round-trips the two complete orders without copying other fields", () => {
    let stored: string | null = null;
    const setItem = vi.fn((_key: string, value: string) => { stored = value; });
    vi.stubGlobal("localStorage", { getItem: () => stored, setItem });

    const additionalFields = { ...alternate, extra: "unrelated" };
    saveOverviewLayout(additionalFields);

    expect(setItem).toHaveBeenCalledExactlyOnceWith(storageKey, JSON.stringify(alternate));
    stored = JSON.stringify(additionalFields);
    expect(loadOverviewLayout()).toEqual(alternate);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    "{invalid",
    "[]",
    JSON.stringify({ metrics: alternate.metrics }),
    JSON.stringify({ ...alternate, metrics: ["memory", "memory", "connections", "download"] }),
    JSON.stringify({ ...alternate, panels: ["logs", "instance", "outbounds", "download"] }),
    JSON.stringify({ ...alternate, panels: ["logs", "instance", "outbounds", "traffic", "other"] }),
  ])("falls back for unavailable or invalid input %s", (stored) => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => stored, setItem });

    expect(loadOverviewLayout()).toBe(defaultOverviewLayout);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("tolerates browser policies that deny reads or writes", () => {
    const blocked = () => { throw new DOMException("Storage denied", "SecurityError"); };
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked });

    expect(loadOverviewLayout()).toBe(defaultOverviewLayout);
    expect(() => saveOverviewLayout(alternate)).not.toThrow();
  });
});
