import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultOverviewLayout,
  loadOverviewLayout,
  type OverviewLayout,
} from "@/features/dashboard/overview-layout";

const storageKey = "singdeck.overview-layout";
const alternate: OverviewLayout = {
  metrics: ["memory", "upload", "connections", "download"],
  panels: ["logs", "instance", "outbounds", "traffic"],
};

afterEach(() => vi.unstubAllGlobals());

describe("Overview layout preferences", () => {
  it("loads both legacy orders without copying other fields or writing", () => {
    const setItem = vi.fn();
    const getItem = vi.fn(() => JSON.stringify({ ...alternate, extra: "unrelated" }));
    vi.stubGlobal("localStorage", { getItem, setItem });

    expect(loadOverviewLayout()).toEqual(alternate);
    expect(getItem).toHaveBeenCalledExactlyOnceWith(storageKey);
    expect(setItem).not.toHaveBeenCalled();
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

  it("tolerates browser policies that deny legacy reads", () => {
    const blocked = () => { throw new DOMException("Storage denied", "SecurityError"); };
    vi.stubGlobal("localStorage", { getItem: blocked });

    expect(loadOverviewLayout()).toBe(defaultOverviewLayout);
  });
});
