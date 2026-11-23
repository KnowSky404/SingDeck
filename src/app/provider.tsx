import {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
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
import {
  claimRememberedConnection,
  finishForgettingConnection,
  getRememberedSelection,
  markRejectedConnection,
  queueConnectionRevocation,
  rememberConnection,
  restoreConnection,
  revokeConfirmedRestore,
  revokeRememberedConnection,
  type RememberedSelection,
} from "@/features/instances/remembered-connection";
import { WorkspaceContext } from "./context";
import { loadLanguage, translate, type Language } from "@/lib/i18n";

const rememberError =
  "Could not remember this connection. Check your browser’s site data settings.";
const restoreError =
  "Could not restore the saved connection. Enter your Bearer token and reconnect.";
const revokeError =
  "Automatic reconnect may still be enabled. Retry forgetting the connection or clear this site’s data.";
const forgetError =
  "Could not forget the saved connection. Clear this site’s data in your browser.";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState(loadProfiles);
  const [activeId, setActiveId] = useState(profiles[0].id);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [shouldConnect, setShouldConnect] = useState(false);
  const [restoringSelection, setRestoringSelection] = useState(
    getRememberedSelection,
  );
  const restoringId = restoringSelection?.id;
  const [restoredSelection, setRestoredSelection] =
    useState<RememberedSelection>();
  const restoredId = restoredSelection?.id;
  const [disconnecting, setDisconnecting] = useState(false);
  const [remembering, setRemembering] = useState(false);
  const restoreAttempt = useRef<{ scope: AbortController; committed: boolean }>(
    null,
  );
  const savedConnection = useRef<{
    id: string;
    profile: Profile;
    pending?: {
      claim: Promise<boolean>;
      controller: AbortController;
      started: boolean;
    };
  }>(null);
  const [storageError, setStorageError] = useState<string>();
  const [language, setLanguage] = useState<Language>(loadLanguage);
  const t = useMemo(() => translate(language), [language]);
  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.title = t("SingDeck · Network workspace");
    try {
      localStorage.setItem("singdeck.language", language);
    } catch {
      /* Language remains available in memory. */
    }
  }, [language, t]);
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
    void finishForgettingConnection().catch(() => setStorageError(forgetError));
  }, []);
  useEffect(() => {
    if (!restoringSelection) return;
    const scope = new AbortController();
    const attempt = { scope, committed: false };
    restoreAttempt.current = attempt;
    void restoreConnection(profiles, restoringSelection, scope.signal, () => {
      attempt.committed = true;
    })
      .then((saved) => {
        if (!saved || scope.signal.aborted) return;
        savedConnection.current = { id: saved.id, profile: saved.profile };
        setRestoredSelection({ id: saved.id, confirmed: true });
        setActiveId(saved.profile.id);
        setTokens({ [saved.profile.id]: saved.token });
        setShouldConnect(true);
      })
      .catch(() => {
        if (scope.signal.aborted) return;
        const latest = loadProfiles();
        setRestoringSelection(null);
        setProfiles(latest);
        setActiveId(latest[0].id);
        setRestoredSelection({
          id: restoringSelection.id,
          confirmed: restoringSelection.confirmed || attempt.committed,
        });
        setStorageError(restoreError);
      })
      .finally(() => {
        if (!scope.signal.aborted) setRestoringSelection(null);
      });
    return () => scope.abort();
  }, [profiles, restoringSelection]);
  useLayoutEffect(() => {
    const saved = savedConnection.current;
    if (!saved || saved.profile !== profile) return;
    if (snapshot.authenticationFailed) {
      saved.pending?.controller.abort();
      const rejected = markRejectedConnection(saved.id);
      void revokeRememberedConnection(saved.id)
        .catch(() => {
          if (!rejected && savedConnection.current === saved) {
            setRestoredSelection(
              (current) => current ?? { id: saved.id, confirmed: true },
            );
            setStorageError(revokeError);
          }
          return queueConnectionRevocation(saved.id);
        })
        .then(() => {
          setRestoredSelection((current) =>
            current?.id === saved.id ? undefined : current,
          );
          if (savedConnection.current === saved) {
            setStorageError((error) =>
              error === revokeError ? undefined : error,
            );
          }
          return finishForgettingConnection().catch(() => {
            if (savedConnection.current === saved) setStorageError(forgetError);
          });
        })
        .catch(() => {
          if (savedConnection.current === saved)
            setStorageError(rejected ? forgetError : revokeError);
        });
      return;
    }
    const pending = saved.pending;
    if (snapshot.phase !== "connected" || !pending || pending.started) return;
    const { signal } = pending.controller;
    if (signal.aborted) return;
    pending.started = true;
    void pending.claim
      .then((claimed) => {
        if (claimed)
          return rememberConnection(saved.id, profile, token, signal);
      })
      .catch(() => {
        if (savedConnection.current === saved && !signal.aborted)
          setStorageError(rememberError);
      })
      .finally(() => {
        saved.pending = undefined;
        if (savedConnection.current === saved) setRemembering(false);
      });
  }, [profile, snapshot.authenticationFailed, snapshot.phase, token]);
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
      const saved = loadProfiles();
      if (
        !saved.some(
          (p) => p.id === profile.id && p.endpoint === profile.endpoint,
        )
      )
        return;
      saveProfiles(
        saved.map((p) =>
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
  }, [snapshot.phase, snapshot.version, profile]);
  function stopRestore() {
    restoreAttempt.current?.scope.abort();
    setRestoringSelection(null);
  }
  function saveProfile(profile: Profile, token: string, remember: boolean) {
    const previousSelection = getRememberedSelection() ?? undefined;
    const previousId = previousSelection?.id;
    stopRestore();
    setRestoredSelection(previousSelection);
    savedConnection.current?.pending?.controller.abort();
    savedConnection.current = null;
    setRemembering(false);
    const next = profiles.some((p) => p.id === profile.id)
      ? profiles.map((p) => (p.id === profile.id ? profile : p))
      : [...profiles, profile];
    let id: string | undefined;
    try {
      saveProfiles(next);
      setStorageError(undefined);
      if (remember) id = crypto.randomUUID();
    } catch {
      setStorageError(
        "Browser storage is unavailable. Settings are kept only until this page closes.",
      );
    }
    const claim = claimRememberedConnection(id).then(
      () => {
        setRestoredSelection((current) =>
          current?.id === previousId ? undefined : current,
        );
        void finishForgettingConnection().catch(() =>
          setStorageError(forgetError),
        );
        return true;
      },
      () => {
        setStorageError(previousId || !id ? revokeError : rememberError);
        return false;
      },
    );
    if (id) {
      savedConnection.current = {
        id,
        profile,
        pending: { claim, controller: new AbortController(), started: false },
      };
      setRemembering(true);
    }
    setProfiles(next);
    setTokens({ [profile.id]: token });
    setActiveId(profile.id);
    setShouldConnect(true);
  }
  function selectProfile(id: string) {
    stopRestore();
    savedConnection.current?.pending?.controller.abort();
    savedConnection.current = null;
    setRemembering(false);
    session.disconnect();
    mockControl.reset();
    setActiveId(id);
    setShouldConnect(id === "demo");
  }
  function disconnect(forget = false) {
    if (disconnecting) return;
    const saved = savedConnection.current;
    const savedId = restoredId ?? saved?.id;
    const id = profile.mode === "native" ? (savedId ?? restoringId) : undefined;
    const confirmed =
      forget ||
      saved?.id === id ||
      (restoredId === id && restoredSelection?.confirmed) ||
      (restoringId === id &&
        (restoringSelection?.confirmed || restoreAttempt.current?.committed));
    if (id) setDisconnecting(true);
    stopRestore();
    saved?.pending?.controller.abort();
    if (profile.mode === "native") setRestoredSelection(undefined);
    savedConnection.current = null;
    setRemembering(false);
    session.disconnect();
    setShouldConnect(false);
    setTokens({});
    setActiveId(profiles[0].id);
    if (!id) return;

    const revocation = confirmed
      ? revokeRememberedConnection(id, saved?.id)
      : revokeConfirmedRestore(id, saved?.id);
    void revocation
      .then(() => {
        setStorageError((error) =>
          error === restoreError ||
          error === revokeError ||
          error === forgetError
            ? undefined
            : error,
        );
        void finishForgettingConnection().catch(() =>
          setStorageError(forgetError),
        );
      })
      .catch(() => {
        setRestoredSelection({ id, confirmed: !!confirmed });
        setStorageError(revokeError);
      })
      .finally(() => setDisconnecting(false));
  }
  return (
    <WorkspaceContext
      value={{
        profile,
        profiles,
        session,
        snapshot,
        theme,
        setTheme,
        language,
        setLanguage,
        t,
        saveProfile,
        selectProfile,
        token,
        restoring: !!restoringId,
        restoredConnection: !!restoredId,
        disconnecting,
        remembering:
          remembering &&
          snapshot.loaded.status === true &&
          !snapshot.authenticationFailed,
        storageError,
        connect: () => {
          if (shouldConnect) session.connect();
          else setShouldConnect(true);
        },
        disconnect: () => disconnect(),
        forgetSavedConnection: () => disconnect(true),
      }}
    >
      {children}
    </WorkspaceContext>
  );
}
