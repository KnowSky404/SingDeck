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
const revision = "0123456789abcdef0123456789abcdef";
const snapshotKey = (field: keyof DisplayPreferences) => `${storageKey}.${revision}.${field}`;

function snapshotFor(display: DisplayPreferences, id = revision) {
  return JSON.stringify({ revision: id, document: JSON.parse(serializeDisplayPreferenceFile(display)) });
}

function stubStorage(initial: Record<string, string>) {
  const entries = new Map(Object.entries(initial));
  const getItem = vi.fn((key: string) => entries.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => { entries.set(key, value); });
  const removeItem = vi.fn((key: string) => { entries.delete(key); });
  vi.stubGlobal("localStorage", { getItem, setItem, removeItem });
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
    const actual = entries.get(storageKey)!;
    expect(JSON.parse(actual)).toEqual({ revision: expect.stringMatching(/^[a-f0-9]{32}$/), document: JSON.parse(serializeDisplayPreferenceFile(snapshot)) });
    expect(setItem).toHaveBeenCalledExactlyOnceWith(storageKey, actual);
    expect(loadDisplayPreferences()).toEqual(snapshot);
    expect(loadSavedOverviewLayout()).toEqual(defaultOverviewLayout);
    expect(Object.fromEntries(entries)).toEqual({ ...legacy, [storageKey]: actual });
  });

  it("uses the previous independent keys until the first import", () => {
    const { entries } = stubStorage({});
    expect(saveDisplayPreference("theme", "light")).toBe(true);
    expect(saveDisplayPreference("language", "zh")).toBe(true);
    expect(Object.fromEntries(entries)).toEqual({ "singdeck.theme": "light", "singdeck.language": "zh" });
  });

  it("writes each ordinary edit independently on the active revision", () => {
    const original = snapshotFor(preferences);
    const { entries, setItem } = stubStorage({ [storageKey]: original });
    expect(saveDisplayPreference("theme", "light")).toBe(true);
    expect(saveDisplayPreference("language", "en")).toBe(true);
    expect(setItem.mock.calls).toEqual([[snapshotKey("theme"), "light"], [snapshotKey("language"), "en"]]);
    expect(entries.get(storageKey)).toBe(original);
    expect(loadDisplayPreferences()).toEqual({ ...preferences, theme: "light", language: "en" });
  });

  it("replaces all edited fields with a new import and clears retired edits", () => {
    const { entries } = stubStorage({ [storageKey]: snapshotFor(preferences), [snapshotKey("theme")]: "light" });
    expect(loadDisplayPreferences().theme).toBe("light");

    expect(saveDisplayPreferences(preferences)).toBe(true);
    expect(loadDisplayPreferences()).toEqual(preferences);
    expect(entries.has(snapshotKey("theme"))).toBe(false);
    expect(JSON.parse(entries.get(storageKey)!).revision).not.toBe(revision);
  });

  it("does not apply or retain an edit started just before another tab imports", () => {
    const replacement: DisplayPreferences = { ...preferences, theme: "system" };
    const { entries, setItem } = stubStorage({ [storageKey]: snapshotFor(preferences) });
    setItem.mockImplementation((key, value) => {
      entries.set(storageKey, snapshotFor(replacement, "ffffffffffffffffffffffffffffffff"));
      entries.set(key, value);
    });

    expect(saveDisplayPreference("theme", "light")).toBe(true);
    expect(loadDisplayPreferences()).toEqual(replacement);
    expect(entries.has(snapshotKey("theme"))).toBe(false);
  });

  it("reads the new snapshot if its preceding edits are retired during a read", () => {
    const replacement: DisplayPreferences = { ...preferences, theme: "system", language: "en" };
    const { entries, getItem } = stubStorage({ [storageKey]: snapshotFor(preferences), [snapshotKey("theme")]: "light" });
    getItem.mockImplementation((key) => {
      if (key === snapshotKey("theme")) {
        entries.set(storageKey, snapshotFor(replacement, "ffffffffffffffffffffffffffffffff"));
        entries.delete(key);
      }
      return entries.get(key) ?? null;
    });

    expect(loadDisplayPreferences()).toEqual(replacement);
  });

  it("does not persist part of an import when the snapshot write is denied", () => {
    const before = { [storageKey]: snapshotFor(preferences), [snapshotKey("theme")]: "system" };
    const { entries, setItem } = stubStorage(before);
    setItem.mockImplementation(() => { throw new DOMException("Denied", "QuotaExceededError"); });

    expect(saveDisplayPreferences({ ...preferences, theme: "light", language: "en" })).toBe(false);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(entries)).toEqual(before);
  });

  it("refuses a regular edit when the latest stored snapshot is unreadable", () => {
    const { getItem, setItem } = stubStorage({ [storageKey]: snapshotFor(preferences) });
    getItem.mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
    vi.stubGlobal("navigator", { language: "en" });

    expect(loadDisplayPreferences()).toEqual({ theme: "system", language: "en", overviewLayout: defaultOverviewLayout });
    expect(loadSavedOverviewLayout()).toBeNull();
    expect(saveDisplayPreference("language", "zh")).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });
});
