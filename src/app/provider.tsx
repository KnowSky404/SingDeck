import {
  useState,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createNativeClient } from "@/api/client";
import { InstanceSession } from "@/api/session";
import { createMockClient, MockControl } from "@/mocks/client";
import {
  loadProfiles,
  saveProfiles,
  mockProfile,
  type Profile,
  type Theme,
} from "@/features/instances/profiles";
import { WorkspaceContext } from "./context";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState(loadProfiles);
  const [activeId, setActiveId] = useState(profiles[0].id);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [shouldConnect, setShouldConnect] = useState(false);
  const [storageError, setStorageError] = useState<string>();
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem("singdeck.theme");
      return saved === "light" || saved === "dark" ? saved : "system";
    } catch {
      return "system";
    }
  });
  const [mockControl] = useState(() => new MockControl());
  const profile =
    activeId === "demo"
      ? mockProfile
      : (profiles.find((p) => p.id === activeId) ?? profiles[0]);
  const token = tokens[profile.id] ?? "";
  const session = useMemo(
    () =>
      new InstanceSession(
        profile.mode === "mock"
          ? createMockClient(mockControl)
          : createNativeClient(profile.endpoint, token),
        profile,
        token,
      ),
    [profile, token, mockControl],
  );
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    if (shouldConnect) session.connect();
    return session.disconnect;
  }, [session, shouldConnect]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.classList.toggle(
        "dark",
        theme === "dark" || (theme === "system" && media.matches),
      );
      document.documentElement.style.colorScheme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    try {
      localStorage.setItem("singdeck.theme", theme);
    } catch {
      /* Theme remains available in memory. */
    }
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    const version = snapshot.version;
    if (snapshot.phase !== "connected" || !version || profile.mode !== "native")
      return;
    try {
      saveProfiles(
        profiles.map((p) =>
          p.id === profile.id
            ? {
                ...p,
                apiVersion: version.apiVersion,
                lastConnected: Date.now(),
              }
            : p,
        ),
      );
    } catch {
      /* The Settings save path reports storage failure; live connection remains usable. */
    }
  }, [snapshot.phase, snapshot.version, profile, profiles]);
  function saveProfile(profile: Profile, token: string) {
    const next = profiles.some((p) => p.id === profile.id)
      ? profiles.map((p) => (p.id === profile.id ? profile : p))
      : [...profiles, profile];
    try {
      saveProfiles(next);
      setStorageError(undefined);
    } catch {
      setStorageError(
        "Browser storage is unavailable. Settings are kept only until this page closes.",
      );
    }
    setProfiles(next);
    setTokens((previous) => ({ ...previous, [profile.id]: token }));
    setActiveId(profile.id);
    setShouldConnect(true);
  }
  function selectProfile(id: string) {
    session.disconnect();
    mockControl.reset();
    setActiveId(id);
    setShouldConnect(id === "demo");
  }
  return (
    <WorkspaceContext
      value={{
        profile,
        profiles,
        session,
        snapshot,
        mockControl,
        theme,
        setTheme,
        saveProfile,
        selectProfile,
        token,
        storageError,
        connect: () => {
          if (shouldConnect) session.connect();
          else setShouldConnect(true);
        },
        disconnect: () => {
          session.disconnect();
          setShouldConnect(false);
        },
      }}
    >
      {children}
    </WorkspaceContext>
  );
}
