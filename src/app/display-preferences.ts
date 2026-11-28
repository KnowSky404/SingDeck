import {
  defaultOverviewLayout,
  loadOverviewLayout,
  parseOverviewLayout,
  type OverviewLayout,
} from "@/features/dashboard/overview-layout";
import type { Theme } from "@/features/instances/profiles";
import { loadLanguage, type Language } from "@/lib/i18n";

const format = "singdeck-display-preferences";
const storageKey = "singdeck.display-preferences";
const legacyKeys = {
  theme: "singdeck.theme",
  language: "singdeck.language",
  overviewLayout: "singdeck.overview-layout",
};
export const displayPreferenceFileLimit = 4096;

export interface DisplayPreferences {
  theme: Theme;
  language: Language;
  overviewLayout: OverviewLayout;
}

export interface SavedOverviewLayout {
  layout: OverviewLayout;
  revision: string | null;
}

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "zh";
}

function parsePreferenceDocument(value: unknown): DisplayPreferences | null {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 5 ||
    !("format" in value) || value.format !== format ||
    !("version" in value) || value.version !== 1 ||
    !("theme" in value) || !isTheme(value.theme) ||
    !("language" in value) || !isLanguage(value.language) ||
    !("overviewLayout" in value) || !value.overviewLayout || typeof value.overviewLayout !== "object" ||
    Object.keys(value.overviewLayout).length !== 2) return null;

  const overviewLayout = parseOverviewLayout(value.overviewLayout);
  return overviewLayout ? { theme: value.theme, language: value.language, overviewLayout } : null;
}

export function parseDisplayPreferenceFile(text: string): DisplayPreferences | null {
  if (text.length > displayPreferenceFileLimit) return null;
  try {
    return parsePreferenceDocument(JSON.parse(text));
  } catch {
    return null;
  }
}

function preferenceDocument({ theme, language, overviewLayout }: DisplayPreferences) {
  const { metrics, panels } = overviewLayout;
  return { format, version: 1, theme, language, overviewLayout: { metrics, panels } };
}

export function serializeDisplayPreferenceFile(preferences: DisplayPreferences): string {
  return `${JSON.stringify(preferenceDocument(preferences), null, 2)}\n`;
}

function loadLegacyTheme(): Theme {
  try {
    const saved = localStorage.getItem(legacyKeys.theme);
    return isTheme(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

function loadLegacyDisplayPreferences(overviewLayout = loadOverviewLayout()): DisplayPreferences {
  return { theme: loadLegacyTheme(), language: loadLanguage(), overviewLayout };
}

function editKey(revision: string, field: keyof DisplayPreferences) {
  return `${storageKey}.${revision}.${field}`;
}

function readStoredSnapshot() {
  const raw = localStorage.getItem(storageKey);
  if (raw === null || raw.length > displayPreferenceFileLimit) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Object.keys(value).length !== 2 ||
      !("revision" in value) || typeof value.revision !== "string" || !/^[a-f0-9]{32}$/.test(value.revision) ||
      !("document" in value)) return null;
    const preferences = parsePreferenceDocument(value.document);
    return preferences ? { raw, revision: value.revision, preferences } : null;
  } catch {
    return null;
  }
}

function readLayoutEdit(revision: string | null): OverviewLayout | null {
  const raw = localStorage.getItem(revision === null ? legacyKeys.overviewLayout : editKey(revision, "overviewLayout"));
  if (raw === null || (revision !== null && raw.length > displayPreferenceFileLimit)) return null;
  try {
    return parseOverviewLayout(JSON.parse(raw));
  } catch {
    return null;
  }
}

function readStoredDisplayPreferences(): { preferences: DisplayPreferences; revision: string } | null {
  let snapshot = readStoredSnapshot();
  for (let attempt = 0; snapshot && attempt < 2; attempt++) {
    const { raw, revision, preferences } = snapshot;
    const theme = localStorage.getItem(editKey(revision, "theme"));
    const language = localStorage.getItem(editKey(revision, "language"));
    const overviewLayout = readLayoutEdit(revision);
    // A concurrent import can retire these edit keys while they are being read.
    if (raw === localStorage.getItem(storageKey)) {
      return {
        preferences: {
          theme: isTheme(theme) ? theme : preferences.theme,
          language: isLanguage(language) ? language : preferences.language,
          overviewLayout: overviewLayout ?? preferences.overviewLayout,
        },
        revision,
      };
    }
    snapshot = readStoredSnapshot();
  }
  return snapshot;
}

export function loadDisplayPreferences(): { preferences: DisplayPreferences; savedOverviewLayout?: SavedOverviewLayout } {
  try {
    const stored = readStoredDisplayPreferences();
    if (stored) return {
      preferences: stored.preferences,
      savedOverviewLayout: { layout: stored.preferences.overviewLayout, revision: stored.revision },
    };
    const savedOverviewLayout = readOverviewLayoutAt(null);
    return { preferences: loadLegacyDisplayPreferences(savedOverviewLayout.layout), savedOverviewLayout };
  } catch {
    return { preferences: loadLegacyDisplayPreferences() };
  }
}

export function loadSavedOverviewLayout(): SavedOverviewLayout | undefined {
  try {
    const stored = readStoredDisplayPreferences();
    return stored
      ? { layout: stored.preferences.overviewLayout, revision: stored.revision }
      : readOverviewLayoutAt(null);
  } catch {
    return undefined;
  }
}

export function sameOverviewLayout(left: OverviewLayout, right: OverviewLayout): boolean {
  return left.metrics.length === right.metrics.length && left.panels.length === right.panels.length &&
    left.metrics.every((card, index) => card === right.metrics[index]) &&
    left.panels.every((card, index) => card === right.panels[index]);
}

function readOverviewLayoutAt(snapshot: ReturnType<typeof readStoredSnapshot>): SavedOverviewLayout {
  const revision = snapshot?.revision ?? null;
  const layout = readLayoutEdit(revision) ?? snapshot?.preferences.overviewLayout ?? defaultOverviewLayout;
  return { layout, revision };
}

function discardEdits(revision: string) {
  try {
    localStorage.removeItem(editKey(revision, "theme"));
    localStorage.removeItem(editKey(revision, "language"));
    localStorage.removeItem(editKey(revision, "overviewLayout"));
  } catch {
    // A retired revision cannot affect the current preferences.
  }
}

export function saveDisplayPreferences(preferences: DisplayPreferences): SavedOverviewLayout | undefined {
  try {
    const previous = readStoredSnapshot();
    const revision = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(storageKey, JSON.stringify({ revision, document: preferenceDocument(preferences) }));
    if (previous) discardEdits(previous.revision);
    return { layout: preferences.overviewLayout, revision };
  } catch {
    return undefined;
  }
}

export function saveDisplayPreference<Key extends "theme" | "language">(key: Key, value: DisplayPreferences[Key]): boolean {
  try {
    const snapshot = readStoredSnapshot();
    const destination = snapshot ? editKey(snapshot.revision, key) : legacyKeys[key];
    localStorage.setItem(destination, value);
    // An edit begun before an import belongs to the old revision.
    if (snapshot && snapshot.raw !== localStorage.getItem(storageKey)) discardEdits(snapshot.revision);
    return true;
  } catch {
    return false;
  }
}

type OverviewLayoutSaveResult =
  | { status: "saved"; saved: SavedOverviewLayout }
  | { status: "stale"; saved?: SavedOverviewLayout }
  | { status: "unavailable" };

function reportChangedOverviewLayout(snapshot: ReturnType<typeof readStoredSnapshot>): OverviewLayoutSaveResult {
  try {
    return { status: "stale", saved: readOverviewLayoutAt(snapshot) };
  } catch {
    // Keep the observed import when storage blocks its optional layout override.
    return snapshot
      ? { status: "stale", saved: { layout: snapshot.preferences.overviewLayout, revision: snapshot.revision } }
      : { status: "stale" };
  }
}

export function saveOverviewLayout(next: OverviewLayout, expected?: SavedOverviewLayout): OverviewLayoutSaveResult {
  try {
    const snapshot = readStoredSnapshot();
    if (expected && expected.revision !== (snapshot?.revision ?? null)) return reportChangedOverviewLayout(snapshot);
    const saved = readOverviewLayoutAt(snapshot);
    const current = readStoredSnapshot();
    if (snapshot?.raw !== current?.raw) return reportChangedOverviewLayout(current);
    if (!expected || !sameOverviewLayout(saved.layout, expected.layout)) return { status: "stale", saved };

    // Keep the write on the checked revision even if an import races with setItem.
    const destination = snapshot ? editKey(snapshot.revision, "overviewLayout") : legacyKeys.overviewLayout;
    localStorage.setItem(destination, JSON.stringify(next));
    const latest = readStoredSnapshot();
    if (snapshot?.raw === latest?.raw) return { status: "saved", saved: { layout: next, revision: saved.revision } };
    if (snapshot && snapshot.revision !== latest?.revision) discardEdits(snapshot.revision);
    return reportChangedOverviewLayout(latest);
  } catch {
    return { status: "unavailable" };
  }
}
