import {
  useCallback,
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
} from "@/features/instances/profiles";
import {
  claimRememberedConnection,
  finishForgettingConnection,
  getRememberedSelection,
  hasUnfinishedRevocation,
  markConnectionRevoked,
  queueConnectionRevocation,
  rememberConnection,
  restoreConnection,
  revokeConfirmedRestore,
  revokeRememberedConnection,
  startRememberedConnection,
  type RememberedSelection,
} from "@/features/instances/remembered-connection";
import { WorkspaceContext } from "./context";
import {
  loadDisplayPreferences,
  loadSavedOverviewLayout,
  saveDisplayPreference,
  saveDisplayPreferences,
  type DisplayPreferences,
} from "./display-preferences";
import { translate } from "@/lib/i18n";

const rememberError =
  "Could not remember this connection. Check your browser’s site data settings.";
const rememberChanged =
  "The saved connection changed before this connection could be remembered. Enable Remember this device on the connection page to retry. If the workspace is open, choose Disconnect first.";
const restoreError =
  "Could not restore the saved connection. Enter your Bearer token and reconnect.";
const authRememberError =
  "The instance rejected the token, so automatic reconnect was disabled. Enter a valid token on the connection page. If the workspace is open, choose Disconnect first.";
const authRecovery =
  "The instance rejected the token. Enter a valid token on the connection page. If the workspace is open, choose Disconnect first.";
const revokeError =
  "Automatic reconnect may still be enabled. Retry forgetting the connection or clear this site’s data.";
const forgetError =
  "Could not forget the saved connection. Clear this site’s data in your browser.";
const storageUnknown =
  "Browser storage could not be checked. A previously saved connection may still reconnect. Clear this site’s data to remove it.";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState(loadProfiles);
  const [activeId, setActiveId] = useState(profiles[0].id);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [shouldConnect, setShouldConnect] = useState<boolean | string>(false);
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
  const connectionClaim = useRef<AbortController>(null);
  const savedConnection = useRef<{
    id: string;
    profile: Profile;
    restored?: boolean;
    pending?: {
      claim: Promise<boolean>;
      controller: AbortController;
      started: boolean;
    };
  }>(null);
  const [storageError, setStorageError] = useState<string>();
  const [displayPreferences, setDisplayPreferences] = useState(loadDisplayPreferences);
  const { language, theme } = displayPreferences;
  const overviewLayoutUnsaved = useRef(false);
  const refreshOverviewLayout = useCallback(() => {
    // Keep this tab's unsaved layout when the user opens Overview again.
    if (overviewLayoutUnsaved.current) return;
    const saved = loadSavedOverviewLayout();
    if (!saved) return;
    setDisplayPreferences((current) => {
      const { metrics, panels } = current.overviewLayout;
      const sameOrder = metrics.every((card, index) => card === saved.metrics[index]) &&
        panels.every((card, index) => card === saved.panels[index]);
      return sameOrder ? current : { ...current, overviewLayout: saved };
    });
  }, []);
  function setDisplayPreference<Key extends keyof DisplayPreferences>(key: Key, value: DisplayPreferences[Key]) {
    const saved = saveDisplayPreference(key, value);
    if (key === "overviewLayout") overviewLayoutUnsaved.current = !saved;
    setDisplayPreferences((current) => ({ ...current, [key]: value }));
  }
  function applyDisplayPreferences(preferences: DisplayPreferences) {
    const saved = saveDisplayPreferences(preferences);
    overviewLayoutUnsaved.current = !saved;
    setDisplayPreferences(preferences);
    return saved;
  }
  const t = useMemo(() => translate(language), [language]);
  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.title = t("SingDeck · Network workspace");
  }, [language, t]);
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
    if (!shouldConnect) return session.disconnect;
    if (shouldConnect === true) {
      session.connect();
      return session.disconnect;
    }
    const saved = savedConnection.current;
    if (saved?.id !== shouldConnect) return session.disconnect;

    const scope = new AbortController();
    const cancelRestore = () => {
      if (scope.signal.aborted || savedConnection.current !== saved) return;
      savedConnection.current = null;
      setRestoringSelection(null);
      setShouldConnect(false);
      setTokens({});
      const latest = loadProfiles();
      setProfiles(latest);
      setActiveId(latest[0].id);
      const selection = getRememberedSelection();
      setRestoredSelection(selection?.id === saved.id ? selection : undefined);
      setStorageError(restoreError);
    };
    void startRememberedConnection(
      saved.id,
      saved.profile,
      () => {
        if (savedConnection.current === saved) {
          saved.restored = false;
          session.connect();
          setRestoringSelection(null);
        }
      },
      scope.signal,
    ).then((started) => {
      if (!started) cancelRestore();
    }, cancelRestore);
    return () => {
      scope.abort();
      session.disconnect();
    };
  }, [session, shouldConnect]);
  useEffect(() => {
    const revoked = hasUnfinishedRevocation();
    void finishForgettingConnection().catch(() => {
      if (revoked && hasUnfinishedRevocation())
        setStorageError((error) => error ?? forgetError);
    });
  }, []);
  useEffect(() => {
    if (!restoringSelection) return;
    const scope = new AbortController();
    const attempt = { scope, committed: false };
    let starting = false;
    restoreAttempt.current = attempt;
    void restoreConnection(profiles, restoringSelection, scope.signal, () => {
      attempt.committed = true;
    })
      .then((saved) => {
        if (scope.signal.aborted) return;
        if (!saved) {
          const selection = getRememberedSelection();
          if (selection?.id === restoringSelection.id)
            setRestoredSelection(selection);
          return;
        }
        starting = true;
        savedConnection.current = {
          id: saved.id,
          profile: saved.profile,
          restored: true,
        };
        setRestoredSelection({ id: saved.id, confirmed: true });
        setActiveId(saved.profile.id);
        setTokens({ [saved.profile.id]: saved.token });
        setShouldConnect(saved.id);
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
        if (!scope.signal.aborted && !starting) setRestoringSelection(null);
      });
    return () => scope.abort();
  }, [profiles, restoringSelection]);
  useLayoutEffect(() => {
    const saved = savedConnection.current;
    if (!saved || saved.profile !== profile) return;
    if (snapshot.authenticationFailed) {
      saved.pending?.controller.abort();
      const revoked = markConnectionRevoked(saved.id);
      const recoveryNotice = () =>
        getRememberedSelection() ? authRecovery : authRememberError;
      void revokeRememberedConnection(saved.id)
        .catch(() => {
          if (savedConnection.current === saved) {
            if (!revoked) {
              setRestoredSelection(
                (current) => current ?? { id: saved.id, confirmed: true },
              );
              setStorageError(revokeError);
            } else {
              setStorageError(recoveryNotice());
            }
          }
          return queueConnectionRevocation(saved.id);
        })
        .then(() => {
          setRestoredSelection((current) =>
            current?.id === saved.id ? undefined : current,
          );
          if (savedConnection.current === saved)
            setStorageError(recoveryNotice());
          return finishForgettingConnection().catch(() => {
            if (savedConnection.current === saved && hasUnfinishedRevocation())
              setStorageError(forgetError);
          });
        })
        .catch(() => {
          if (savedConnection.current === saved)
            setStorageError(revoked ? forgetError : revokeError);
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
      .then((remembered) => {
        if (savedConnection.current !== saved || signal.aborted) return;
        if (remembered === false) setStorageError(rememberChanged);
        if (remembered === true && !hasUnfinishedRevocation()) {
          setStorageError((error) =>
            error === forgetError ? undefined : error,
          );
        }
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
  function stopPreparingConnection() {
    connectionClaim.current?.abort();
    restoreAttempt.current?.scope.abort();
    setRestoringSelection(null);
  }
  function saveProfile(profile: Profile, token: string, remember: boolean) {
    const previousSelection = getRememberedSelection() ?? undefined;
    const previousId = previousSelection?.id;
    if (previousId && !remember) markConnectionRevoked(previousId);
    stopPreparingConnection();
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
    const finishCleanup = () => {
      void finishForgettingConnection()
        .then(() => {
          if (previousId && getRememberedSelection()?.id !== previousId) {
            setRestoredSelection((current) =>
              current?.id === previousId ? undefined : current,
            );
          }
        })
        .catch(() => {
          if (hasUnfinishedRevocation())
            setStorageError((error) => error ?? forgetError);
        });
    };
    const controller = new AbortController();
    connectionClaim.current = controller;
    const claim = claimRememberedConnection(id, controller.signal)
      .then(
        (needsCleanup) => {
          setRestoredSelection((current) =>
            current?.id === previousId ? undefined : current,
          );
          if (needsCleanup) finishCleanup();
          return true;
        },
        () => {
          const needsCleanup = hasUnfinishedRevocation();
          if (needsCleanup) finishCleanup();
          if (controller.signal.aborted) return false;
          if (needsCleanup === undefined) setStorageError(storageUnknown);
          else if (getRememberedSelection()) setStorageError(revokeError);
          else if (id) setStorageError(rememberError);
          else if (previousId || needsCleanup) setStorageError(forgetError);
          return false;
        },
      )
      .finally(() => {
        if (connectionClaim.current === controller)
          connectionClaim.current = null;
      });
    if (id) {
      savedConnection.current = {
        id,
        profile,
        pending: { claim, controller, started: false },
      };
      setRemembering(true);
    }
    setProfiles(next);
    setTokens({ [profile.id]: token });
    setActiveId(profile.id);
    setShouldConnect(true);
  }
  function selectProfile(id: string) {
    stopPreparingConnection();
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
    const revoked = !!id && !!confirmed && markConnectionRevoked(id);
    const pendingRevoked =
      !saved?.id || saved.id === id || markConnectionRevoked(saved.id);
    if (id) setDisconnecting(true);
    stopPreparingConnection();
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
        const selection = getRememberedSelection();
        if (!confirmed && selection?.id === id) setRestoredSelection(selection);
        setStorageError((error) =>
          error === restoreError ||
          error === authRememberError ||
          error === authRecovery ||
          error === revokeError ||
          error === forgetError
            ? undefined
            : error,
        );
        void finishForgettingConnection().catch(() => {
          if (hasUnfinishedRevocation()) setStorageError(forgetError);
        });
      })
      .catch(() => {
        setRestoredSelection({ id, confirmed: !!confirmed });
        setStorageError(revoked && pendingRevoked ? forgetError : revokeError);
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
        ...displayPreferences,
        setTheme: (theme) => setDisplayPreference("theme", theme),
        setLanguage: (language) => setDisplayPreference("language", language),
        setOverviewLayout: (layout) => setDisplayPreference("overviewLayout", layout),
        refreshOverviewLayout,
        applyDisplayPreferences,
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
          const saved = savedConnection.current;
          if (
            typeof shouldConnect === "string" &&
            (saved?.id !== shouldConnect || saved.restored)
          )
            return;
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
