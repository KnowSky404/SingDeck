import { validateEndpoint } from "@/api/client";

export type Theme = "light" | "dark" | "system";
export interface Profile {
  id: string;
  name: string;
  endpoint: string;
  mode: "native" | "mock";
  tls: boolean;
  lastConnected?: number;
  apiVersion?: number;
  preferences: {
    autoReconnect: boolean;
    intervalMs: number;
    windowSeconds: number;
  };
}
export function inferDefaultEndpoint(
  page?: Pick<Location, "origin" | "pathname">,
) {
  if (page?.pathname.startsWith("/dashboard/")) {
    try {
      return validateEndpoint(page.origin);
    } catch {
      // Keep the entry form usable when its hosting origin is not a valid API endpoint.
    }
  }
  return "http://127.0.0.1:9090";
}

const initialEndpoint = inferDefaultEndpoint(
  typeof location === "undefined" ? undefined : location,
);

export const defaultProfile: Profile = {
  id: "local",
  name: "sing-box instance",
  endpoint: initialEndpoint,
  mode: "native",
  tls: initialEndpoint.startsWith("https:"),
  preferences: { autoReconnect: true, intervalMs: 1000, windowSeconds: 60 },
};
export const mockProfile: Profile = {
  ...defaultProfile,
  id: "demo",
  name: "Demo workspace",
  mode: "mock",
  endpoint: "",
  tls: false,
};

export function loadProfiles(): Profile[] {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem("singdeck.profiles.v1") ?? "[]",
    );
    if (!Array.isArray(saved)) return [defaultProfile];
    const profiles: Profile[] = [];
    for (const item of saved.slice(0, 20)) {
      if (!item || typeof item !== "object") continue;
      const p = item as Record<string, unknown>;
      const prefs = p.preferences as Profile["preferences"] | undefined;
      if (
        typeof p.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id) ||
        ["demo", "__proto__", "constructor", "prototype"].includes(p.id) ||
        typeof p.name !== "string" ||
        typeof p.endpoint !== "string" ||
        p.mode !== "native"
      )
        continue;
      try {
        const endpoint = validateEndpoint(p.endpoint);
        profiles.push({
          id: p.id.slice(0, 80),
          name: p.name.slice(0, 80),
          endpoint,
          mode: "native",
          tls: endpoint.startsWith("https:"),
          lastConnected:
            typeof p.lastConnected === "number" ? p.lastConnected : undefined,
          apiVersion:
            typeof p.apiVersion === "number" ? p.apiVersion : undefined,
          preferences: {
            autoReconnect: prefs?.autoReconnect !== false,
            intervalMs: [1000, 2000, 5000].includes(prefs?.intervalMs ?? 0)
              ? prefs!.intervalMs
              : 1000,
            windowSeconds: [60, 180, 300].includes(prefs?.windowSeconds ?? 0)
              ? prefs!.windowSeconds
              : 60,
          },
        });
      } catch {
        /* Ignore invalid endpoints in saved profile metadata. */
      }
    }
    return profiles.length ? profiles : [defaultProfile];
  } catch {
    return [defaultProfile];
  }
}

export function saveProfiles(profiles: Profile[]) {
  // Explicit allowlist prevents accidentally persisting credentials attached by a caller.
  localStorage.setItem(
    "singdeck.profiles.v1",
    JSON.stringify(
      profiles
        .filter((p) => p.mode === "native")
        .map((p) => ({
          id: p.id,
          name: p.name,
          endpoint: validateEndpoint(p.endpoint),
          mode: p.mode,
          tls: p.tls,
          lastConnected: p.lastConnected,
          apiVersion: p.apiVersion,
          preferences: p.preferences,
        })),
    ),
  );
}
