import { afterEach, describe, expect, it, vi } from "vitest";
import {
  displayPreferenceFileLimit,
  loadDisplayPreferences,
  loadSavedOverviewLayout,
  parseDisplayPreferenceFile,
  saveDisplayPreference,
  saveDisplayPreferences,
  saveOverviewLayout,
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
const basis = (layout: DisplayPreferences["overviewLayout"], activeRevision: string | null = revision) =>
  ({ layout, revision: activeRevision });

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
    const legacyBasis = basis(preferences.overviewLayout, null);
    expect(loadDisplayPreferences()).toEqual({ preferences, savedOverviewLayout: legacyBasis });
    expect(loadSavedOverviewLayout()).toEqual(legacyBasis);
    expect(setItem).not.toHaveBeenCalled();

    const snapshot: DisplayPreferences = { theme: "system", language: "en", overviewLayout: defaultOverviewLayout };
    const result = saveDisplayPreferences(snapshot);
    const actual = entries.get(storageKey)!;
    expect(JSON.parse(actual)).toEqual({ revision: expect.stringMatching(/^[a-f0-9]{32}$/), document: JSON.parse(serializeDisplayPreferenceFile(snapshot)) });
    const imported = basis(defaultOverviewLayout, JSON.parse(actual).revision);
    expect(result).toEqual(imported);
    expect(setItem).toHaveBeenCalledExactlyOnceWith(storageKey, actual);
    expect(loadDisplayPreferences()).toEqual({ preferences: snapshot, savedOverviewLayout: imported });
    expect(loadSavedOverviewLayout()).toEqual(imported);
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
    expect(loadDisplayPreferences().preferences).toEqual({ ...preferences, theme: "light", language: "en" });
  });

  it("replaces all edited fields with a new import and clears retired edits", () => {
    const { entries } = stubStorage({ [storageKey]: snapshotFor(preferences), [snapshotKey("theme")]: "light" });
    expect(loadDisplayPreferences().preferences.theme).toBe("light");

    expect(saveDisplayPreferences(preferences)).toBeDefined();
    expect(loadDisplayPreferences().preferences).toEqual(preferences);
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
    expect(loadDisplayPreferences().preferences).toEqual(replacement);
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

    expect(loadDisplayPreferences()).toEqual({
      preferences: replacement,
      savedOverviewLayout: basis(replacement.overviewLayout, "ffffffffffffffffffffffffffffffff"),
    });
  });

  it("does not persist part of an import when the snapshot write is denied", () => {
    const latestRevision = "ffffffffffffffffffffffffffffffff";
    const before = {
      [storageKey]: snapshotFor(preferences, latestRevision),
      [`${storageKey}.${latestRevision}.overviewLayout`]: JSON.stringify(defaultOverviewLayout),
      [`${storageKey}.${latestRevision}.theme`]: "system",
    };
    const { entries, setItem } = stubStorage(before);
    setItem.mockImplementation(() => { throw new DOMException("Denied", "QuotaExceededError"); });

    expect(saveDisplayPreferences({ ...preferences, theme: "light", language: "en" })).toBeUndefined();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(entries)).toEqual(before);
  });

  it("can replace the imported document when its old layout override cannot be read", () => {
    const { entries, getItem } = stubStorage({ [storageKey]: snapshotFor(preferences) });
    getItem.mockImplementation((key) => {
      if (key === snapshotKey("overviewLayout")) throw new DOMException("Denied", "SecurityError");
      return entries.get(key) ?? null;
    });
    const replacement = { ...preferences, overviewLayout: defaultOverviewLayout };
    const result = saveDisplayPreferences(replacement);
    expect(result).toEqual(basis(defaultOverviewLayout, JSON.parse(entries.get(storageKey)!).revision));
    expect(getItem).not.toHaveBeenCalledWith(snapshotKey("overviewLayout"));
    expect(loadDisplayPreferences().preferences).toEqual(replacement);
  });

  it("refuses a regular edit when the latest stored snapshot is unreadable", () => {
    const { getItem, setItem } = stubStorage({ [storageKey]: snapshotFor(preferences) });
    getItem.mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
    vi.stubGlobal("navigator", { language: "en" });

    expect(loadDisplayPreferences()).toEqual({
      preferences: { theme: "system", language: "en", overviewLayout: defaultOverviewLayout },
    });
    expect(loadSavedOverviewLayout()).toBeUndefined();
    expect(saveDisplayPreference("language", "zh")).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe("Overview layout edits", () => {
  const next: DisplayPreferences["overviewLayout"] = {
    ...preferences.overviewLayout,
    metrics: ["upload", "memory", "connections", "download"],
  };
  const importedRevision = "ffffffffffffffffffffffffffffffff";
  const importedLayoutKey = `${storageKey}.${importedRevision}.overviewLayout`;
  const importedThemeKey = `${storageKey}.${importedRevision}.theme`;
  const importedLanguageKey = `${storageKey}.${importedRevision}.language`;
  const replacement = snapshotFor(preferences, importedRevision);
  const original = snapshotFor(preferences);
  const legacyLayoutKey = "singdeck.overview-layout";

  it("refreshes from the new revision's effective layout before accepting another move", () => {
    const { entries, setItem } = stubStorage({
      [storageKey]: replacement,
      [importedLayoutKey]: JSON.stringify(defaultOverviewLayout),
      [importedThemeKey]: "light",
      [importedLanguageKey]: "en",
    });
    expect(saveOverviewLayout(next, basis(preferences.overviewLayout)))
      .toEqual({ status: "stale", saved: basis(defaultOverviewLayout, importedRevision) });
    expect(setItem).not.toHaveBeenCalled();

    const moved = { ...defaultOverviewLayout, metrics: next.metrics };
    expect(saveOverviewLayout(moved, basis(defaultOverviewLayout, importedRevision)))
      .toEqual({ status: "saved", saved: basis(moved, importedRevision) });
    expect(setItem).toHaveBeenCalledExactlyOnceWith(importedLayoutKey, JSON.stringify(moved));
    expect(entries.get(storageKey)).toBe(replacement);
    expect(loadDisplayPreferences().preferences).toEqual({ theme: "light", language: "en", overviewLayout: moved });
  });

  it("keeps a newer import with identical saved orders from inheriting an unsaved edit", () => {
    const { entries, setItem } = stubStorage({ [storageKey]: replacement });
    const withUnsavedPanels: DisplayPreferences["overviewLayout"] = {
      ...next,
      panels: ["instance", "logs", "outbounds", "traffic"],
    };
    expect(saveOverviewLayout(withUnsavedPanels, basis(preferences.overviewLayout))).toEqual({
      status: "stale",
      saved: basis(preferences.overviewLayout, importedRevision),
    });
    expect(setItem).not.toHaveBeenCalled();
    expect(Object.fromEntries(entries)).toEqual({ [storageKey]: replacement });
  });

  it("leaves storage untouched if an import arrives while reading the previous layout", () => {
    const { entries, getItem, setItem } = stubStorage({ [storageKey]: original });
    getItem.mockImplementation((key) => {
      if (key === snapshotKey("overviewLayout")) entries.set(storageKey, replacement);
      return entries.get(key) ?? null;
    });
    expect(saveOverviewLayout(next, basis(preferences.overviewLayout)))
      .toEqual({ status: "stale", saved: basis(preferences.overviewLayout, importedRevision) });
    expect(setItem).not.toHaveBeenCalled();
  });

  it("keeps an interleaved write on its original revision and reports the newly imported layout", () => {
    const { entries, setItem } = stubStorage({ [storageKey]: original });
    setItem.mockImplementation((key, value) => {
      entries.set(storageKey, replacement);
      entries.set(importedLayoutKey, JSON.stringify(defaultOverviewLayout));
      entries.set(importedThemeKey, "light");
      entries.set(key, value);
    });
    expect(saveOverviewLayout(next, basis(preferences.overviewLayout)))
      .toEqual({ status: "stale", saved: basis(defaultOverviewLayout, importedRevision) });
    expect(setItem).toHaveBeenCalledExactlyOnceWith(snapshotKey("overviewLayout"), JSON.stringify(next));
    expect(entries.has(snapshotKey("overviewLayout"))).toBe(false);
    expect(loadDisplayPreferences().preferences).toEqual({ ...preferences, theme: "light", overviewLayout: defaultOverviewLayout });
  });

  it("uses the observed import when storage denies its layout override", () => {
    const { entries, getItem, setItem } = stubStorage({ [storageKey]: original });
    getItem.mockImplementation((key) => {
      if (key === snapshotKey("overviewLayout")) {
        entries.set(storageKey, snapshotFor({ ...preferences, overviewLayout: defaultOverviewLayout }, importedRevision));
      }
      if (key === importedLayoutKey) throw new DOMException("Denied", "SecurityError");
      return entries.get(key) ?? null;
    });
    expect(saveOverviewLayout(next, basis(preferences.overviewLayout)))
      .toEqual({ status: "stale", saved: basis(defaultOverviewLayout, importedRevision) });
    expect(setItem).not.toHaveBeenCalled();
  });

  it("compares and writes the legacy layout until the first import", () => {
    const { entries, setItem } = stubStorage({
      [legacyLayoutKey]: JSON.stringify(preferences.overviewLayout),
      "singdeck.theme": "light",
    });
    expect(saveOverviewLayout(next, basis(defaultOverviewLayout, null)))
      .toEqual({ status: "stale", saved: basis(preferences.overviewLayout, null) });
    expect(setItem).not.toHaveBeenCalled();
    expect(saveOverviewLayout(next, basis(preferences.overviewLayout, null)))
      .toEqual({ status: "saved", saved: basis(next, null) });
    expect(setItem).toHaveBeenCalledExactlyOnceWith(legacyLayoutKey, JSON.stringify(next));
    expect(Object.fromEntries(entries)).toEqual({ [legacyLayoutKey]: JSON.stringify(next), "singdeck.theme": "light" });
  });

  it("refreshes an unverified basis even when storage has no imported document", () => {
    const { setItem } = stubStorage({});
    expect(saveOverviewLayout(next)).toEqual({
      status: "stale",
      saved: basis(defaultOverviewLayout, null),
    });
    expect(setItem).not.toHaveBeenCalled();
  });

  it.each([storageKey, legacyLayoutKey])("reports unavailable without writing when %s cannot be read", (deniedKey) => {
    const { getItem, setItem } = stubStorage({});
    getItem.mockImplementation((key) => {
      if (key === deniedKey) throw new DOMException("Denied", "SecurityError");
      return null;
    });
    expect(saveOverviewLayout(next, basis(defaultOverviewLayout, null))).toEqual({ status: "unavailable" });
    expect(setItem).not.toHaveBeenCalled();
  });

  it("reports unavailable when the layout write is denied", () => {
    const { entries, setItem } = stubStorage({ [storageKey]: original });
    setItem.mockImplementation(() => { throw new DOMException("Denied", "QuotaExceededError"); });
    expect(saveOverviewLayout(next, basis(preferences.overviewLayout))).toEqual({ status: "unavailable" });
    expect(Object.fromEntries(entries)).toEqual({ [storageKey]: original });
  });
});
