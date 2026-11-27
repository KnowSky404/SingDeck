import { loadOverviewLayout, parseOverviewLayout, type OverviewLayout } from "@/features/dashboard/overview-layout";
import type { Theme } from "@/features/instances/profiles";
import { loadLanguage, type Language } from "@/lib/i18n";

const format = "singdeck-display-preferences";
const storageKey = "singdeck.display-preferences";
export const displayPreferenceFileLimit = 4096;

export interface DisplayPreferences {
  theme: Theme;
  language: Language;
  overviewLayout: OverviewLayout;
}

export function parseDisplayPreferenceFile(text: string): DisplayPreferences | null {
  if (text.length > displayPreferenceFileLimit) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Object.keys(value).length !== 5 ||
      !("format" in value) || value.format !== format ||
      !("version" in value) || value.version !== 1 ||
      !("theme" in value) || (value.theme !== "light" && value.theme !== "dark" && value.theme !== "system") ||
      !("language" in value) || (value.language !== "en" && value.language !== "zh") ||
      !("overviewLayout" in value) || !value.overviewLayout || typeof value.overviewLayout !== "object" ||
      Object.keys(value.overviewLayout).length !== 2) return null;

    const overviewLayout = parseOverviewLayout(value.overviewLayout);
    return overviewLayout ? { theme: value.theme, language: value.language, overviewLayout } : null;
  } catch {
    return null;
  }
}

export function serializeDisplayPreferenceFile({ theme, language, overviewLayout }: DisplayPreferences): string {
  const { metrics, panels } = overviewLayout;
  return `${JSON.stringify({ format, version: 1, theme, language, overviewLayout: { metrics, panels } }, null, 2)}\n`;
}

function loadLegacyTheme(): Theme {
  try {
    const saved = localStorage.getItem("singdeck.theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

function loadLegacyDisplayPreferences(): DisplayPreferences {
  return { theme: loadLegacyTheme(), language: loadLanguage(), overviewLayout: loadOverviewLayout() };
}

function readStoredDisplayPreferences(): DisplayPreferences | null {
  const stored = localStorage.getItem(storageKey);
  return stored === null ? null : parseDisplayPreferenceFile(stored);
}

export function loadDisplayPreferences(): DisplayPreferences {
  try {
    return readStoredDisplayPreferences() ?? loadLegacyDisplayPreferences();
  } catch {
    return loadLegacyDisplayPreferences();
  }
}

export function saveDisplayPreferences(preferences: DisplayPreferences): boolean {
  try {
    localStorage.setItem(storageKey, serializeDisplayPreferenceFile(preferences));
    return true;
  } catch {
    return false;
  }
}

export function saveDisplayPreference<Key extends keyof DisplayPreferences>(key: Key, value: DisplayPreferences[Key]): boolean {
  try {
    const stored = readStoredDisplayPreferences() ?? loadLegacyDisplayPreferences();
    return saveDisplayPreferences({ ...stored, [key]: value });
  } catch {
    return false;
  }
}
