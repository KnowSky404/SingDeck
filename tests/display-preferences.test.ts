import { afterEach, describe, expect, it, vi } from "vitest";
import {
  displayPreferenceFileLimit,
  loadDisplayPreferences,
  loadSavedOverviewLayout,
  parseDisplayPreferenceFile,
  saveDisplayPreference,
  saveDisplayPreferences,
  serializeDisplayPreferenceFile,
  type DisplayPreferences,
} from "@/app/display-preferences";
import { defaultOverviewLayout } from "@/features/dashboard/overview-layout";

const storageKey = "singdeck.display-preferences";
const preferences: DisplayPreferences = {
  theme: "dark",
  language: "zh",
  overviewLayout: {
    metrics: ["memory", "upload", "connections", "download"],
    panels: ["logs", "instance", "outbounds", "traffic"],
  },
};
const file = { format: "singdeck-display-preferences", version: 1, ...preferences };

function stubStorage(initial: Record<string, string>) {
  const entries = new Map(Object.entries(initial));
  const getItem = vi.fn((key: string) => entries.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => { entries.set(key, value); });
  vi.stubGlobal("localStorage", { getItem, setItem });
  return { entries, getItem, setItem };
}

afterEach(() => vi.unstubAllGlobals());

describe("display preference file", () => {
  it("round trips only the three explicitly selected display fields", () => {
    const extra = { ...preferences, profile: "other data", overviewLayout: { ...preferences.overviewLayout, extra: true } };
    const serialized = serializeDisplayPreferenceFile(extra);

    expect(JSON.parse(serialized)).toEqual(file);
    expect(parseDisplayPreferenceFile(serialized)).toEqual(preferences);
  });

  it.each([
    ["malformed JSON", "{"],
    ["array", "[]"],
    ["wrong format", JSON.stringify({ ...file, format: "unrelated" })],
    ["future version", JSON.stringify({ ...file, version: 2 })],
    ["unknown root key", JSON.stringify({ ...file, unknown: "irrelevant" })],
    ["missing field disguised by an unknown key", JSON.stringify({ ...file, language: undefined, unknown: "zh" })],
    ["invalid theme", JSON.stringify({ ...file, theme: "blue" })],
    ["invalid language", JSON.stringify({ ...file, language: "zh-CN" })],
    ["invalid order with otherwise valid fields", JSON.stringify({ ...file, overviewLayout: { ...preferences.overviewLayout, panels: ["logs", "logs", "outbounds", "traffic"] } })],
    ["unknown nested key", JSON.stringify({ ...file, overviewLayout: { ...preferences.overviewLayout, count: 4 } })],
    ["oversize valid JSON", JSON.stringify(file).padEnd(displayPreferenceFileLimit + 1)],
  ])("rejects %s", (_case, text) => {
    expect(parseDisplayPreferenceFile(text)).toBeNull();
  });
});

describe("display preference storage", () => {
  it("reads each legacy preference without rewriting it and prioritizes a valid new snapshot", () => {
    const legacy = {
      "singdeck.theme": "dark",
      "singdeck.language": "zh",
      "singdeck.overview-layout": JSON.stringify(preferences.overviewLayout),
    };
    const { entries, setItem } = stubStorage({ ...legacy, [storageKey]: "invalid" });
    expect(loadDisplayPreferences()).toEqual(preferences);
    expect(loadSavedOverviewLayout()).toEqual(preferences.overviewLayout);
    expect(setItem).not.toHaveBeenCalled();

    const snapshot: DisplayPreferences = { theme: "system", language: "en", overviewLayout: defaultOverviewLayout };
    expect(saveDisplayPreferences(snapshot)).toBe(true);
    expect(setItem).toHaveBeenCalledExactlyOnceWith(storageKey, serializeDisplayPreferenceFile(snapshot));
    expect(loadDisplayPreferences()).toEqual(snapshot);
    expect(loadSavedOverviewLayout()).toEqual(defaultOverviewLayout);
    expect(Object.fromEntries(entries)).toEqual({ ...legacy, [storageKey]: serializeDisplayPreferenceFile(snapshot) });
  });

  it("merges a regular edit with the latest stored preferences rather than overwriting other choices", () => {
    stubStorage({ [storageKey]: serializeDisplayPreferenceFile(preferences) });
    expect(saveDisplayPreference("theme", "light")).toBe(true);
    expect(loadDisplayPreferences()).toEqual({ ...preferences, theme: "light" });
  });

  it("does not persist part of an import when the snapshot write is denied", () => {
    const before = serializeDisplayPreferenceFile(preferences);
    const { entries, setItem } = stubStorage({ [storageKey]: before });
    setItem.mockImplementation(() => { throw new DOMException("Denied", "QuotaExceededError"); });

    expect(saveDisplayPreferences({ ...preferences, theme: "light", language: "en" })).toBe(false);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(Array.from(entries)).toEqual([[storageKey, before]]);
  });

  it("refuses a regular edit when the latest stored snapshot is unreadable", () => {
    const { getItem, setItem } = stubStorage({ [storageKey]: serializeDisplayPreferenceFile(preferences) });
    getItem.mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
    vi.stubGlobal("navigator", { language: "en" });

    expect(loadDisplayPreferences()).toEqual({ theme: "system", language: "en", overviewLayout: defaultOverviewLayout });
    expect(loadSavedOverviewLayout()).toBeNull();
    expect(saveDisplayPreference("language", "zh")).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });
});
