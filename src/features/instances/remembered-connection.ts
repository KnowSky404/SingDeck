import { loadProfiles, type Profile } from "./profiles";

export interface RememberedSelection {
  id: string;
  confirmed: boolean;
}

interface RememberedConnection {
  id: string;
  profileId: string;
  endpoint: string;
  key: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}

const marker = "singdeck.remembered-connection";
const revokedPrefix = `${marker}.revoked.`;
const storeName = "connections";
const slot = "active";

function withConnectionLock<T>(
  action: () => T,
  signal = AbortSignal.timeout(3000),
) {
  return navigator.locks.request(marker, { signal }, action);
}

export function canRememberConnection() {
  return !!(
    globalThis.crypto?.subtle &&
    globalThis.indexedDB &&
    navigator.locks &&
    typeof AbortSignal.timeout === "function"
  );
}

export function getRememberedSelection() {
  try {
    return canRememberConnection() ? restorableSelection() : null;
  } catch {
    return null;
  }
}

export async function claimRememberedConnection(id?: string) {
  if (!canRememberConnection()) return false;
  return withConnectionLock(() => {
    const hadSelection = !!localStorage.getItem(marker);
    revokeConnection(currentSelection()?.id);
    // Keep replacement cleanup in the existing marker so it fits at browser quota.
    if (id) localStorage.setItem(marker, (hadSelection ? "~" : "?") + id);
    return hadSelection;
  });
}

function currentSelection(): RememberedSelection | null {
  const value = localStorage.getItem(marker);
  if (!value || !/[+?~]/.test(value[0])) return null;
  return { id: value.slice(1), confirmed: value[0] === "+" };
}

function restorableSelection() {
  const selection = currentSelection();
  return selection && !localStorage.getItem(revokedPrefix + selection.id)
    ? selection
    : null;
}

export function markConnectionRevoked(id: string) {
  try {
    if (currentSelection()?.id === id)
      localStorage.setItem(revokedPrefix + id, "1");
    return true;
  } catch {
    return false;
  }
}

function confirmConnection(id: string) {
  try {
    if (localStorage.getItem(marker) === "~" + id)
      localStorage.setItem(marker, "?" + id);
    localStorage.setItem(marker, "+" + id);
  } catch {
    // A matching IndexedDB record can still be restored with its pending selection.
  }
}

function openStorage(signal?: AbortSignal) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    signal?.throwIfAborted();
    const request = indexedDB.open(marker, 1);
    const abort = () => reject(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    request.onupgradeneeded = () => {
      if (signal?.aborted) request.transaction?.abort();
      else request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => {
      signal?.removeEventListener("abort", abort);
      reject(request.error);
    };
  });
}

async function accessStorage<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T> | undefined,
  { locked, signal }: { locked?: boolean; signal?: AbortSignal } = {},
) {
  const db = await openStorage(signal);
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const start = () => {
        signal?.throwIfAborted();
        const transaction = db.transaction(storeName, mode);
        const request = operation(transaction.objectStore(storeName));
        const abort = () => {
          if (mode === "readonly") reject(signal?.reason);
          try {
            transaction.abort();
          } catch {
            // Once commit starts, the transaction events determine whether the write succeeded.
          }
        };
        signal?.addEventListener("abort", abort, { once: true });
        transaction.oncomplete = () => {
          signal?.removeEventListener("abort", abort);
          if (mode === "readonly" && signal?.aborted) reject(signal.reason);
          else resolve(request?.result);
        };
        transaction.onabort = () => {
          signal?.removeEventListener("abort", abort);
          reject(signal?.aborted ? signal.reason : transaction.error);
        };
      };
      // Schedule the write under the lock without holding it during IndexedDB I/O.
      if (locked) void withConnectionLock(start, signal).catch(reject);
      else start();
    });
  } finally {
    db.close();
  }
}

async function withStorageDeadline<T>(
  signal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
) {
  const deadline = AbortSignal.timeout(3000);
  const scope = new AbortController();
  const cancel = () => scope.abort(signal?.reason);
  const timeOut = () => scope.abort(deadline.reason);
  signal?.throwIfAborted();
  signal?.addEventListener("abort", cancel, { once: true });
  deadline.addEventListener("abort", timeOut, { once: true });
  try {
    return await operation(scope.signal);
  } finally {
    signal?.removeEventListener("abort", cancel);
    deadline.removeEventListener("abort", timeOut);
  }
}

function readStoredConnection(signal?: AbortSignal) {
  return withStorageDeadline(signal, (scope) =>
    accessStorage<RememberedConnection>(
      "readonly",
      (store) => store.get(slot),
      { signal: scope },
    ),
  );
}

function binding(id: string, profile: Profile) {
  return new TextEncoder().encode(
    JSON.stringify([id, profile.id, profile.endpoint]),
  );
}

export async function restoreConnection(
  profiles: Profile[],
  { id, confirmed }: RememberedSelection,
  signal: AbortSignal,
  onCredential: () => void,
) {
  if (!(await withConnectionLock(() => restorableSelection()?.id === id)))
    return;
  const saved = await readStoredConnection(signal);
  // An opted-in connection may still be awaiting verification and have no credential.
  if (saved?.id !== id) {
    if (confirmed && restorableSelection()?.id === id)
      throw new Error("Remembered credential unavailable.");
    return;
  }
  signal.throwIfAborted();
  onCredential();
  const profile = profiles.find((profile) => profile.id === saved.profileId);
  if (!profile || profile.endpoint !== saved.endpoint) {
    if (await withConnectionLock(() => restorableSelection()?.id === id))
      throw new Error("Remembered profile or endpoint unavailable.");
    return;
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: saved.iv, additionalData: binding(id, profile) },
    saved.key,
    saved.ciphertext,
  );
  return withConnectionLock(() => {
    signal.throwIfAborted();
    if (restorableSelection()?.id !== id) return;
    const latest = loadProfiles().find((saved) => saved.id === profile.id);
    if (latest?.endpoint !== profile.endpoint)
      throw new Error("Remembered endpoint changed during restore.");
    confirmConnection(id);
    return { id, profile, token: new TextDecoder().decode(plaintext) };
  });
}

export async function rememberConnection(
  id: string,
  profile: Profile,
  token: string,
  signal: AbortSignal,
) {
  if (restorableSelection()?.id !== id) return false;
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: binding(id, profile) },
    key,
    new TextEncoder().encode(token),
  );
  signal.throwIfAborted();
  const saved: RememberedConnection = {
    id,
    profileId: profile.id,
    endpoint: profile.endpoint,
    key,
    iv,
    ciphertext,
  };
  const written = await withStorageDeadline(signal, (scope) =>
    accessStorage(
      "readwrite",
      (store) => {
        const latest = loadProfiles().find((saved) => saved.id === profile.id);
        if (
          scope.aborted ||
          restorableSelection()?.id !== id ||
          latest?.endpoint !== profile.endpoint
        )
          return;
        return store.put(saved, slot);
      },
      { locked: true, signal: scope },
    ),
  );
  if (written === undefined) return false;
  return withConnectionLock(() => {
    if (signal.aborted || restorableSelection()?.id !== id) return false;
    confirmConnection(id);
    return true;
  }).catch(() => {
    // A committed record remains usable while its selection is still current.
    return restorableSelection()?.id === id;
  });
}

function revokeConnection(id?: string) {
  if (!id) return;
  if (currentSelection()?.id === id) {
    // A same-size marker revokes reconnect immediately and survives an interrupted delete.
    localStorage.setItem(marker, "-" + id);
  }
  localStorage.removeItem(revokedPrefix + id);
}

export function revokeRememberedConnection(id: string, pendingId?: string) {
  return withConnectionLock(() => {
    revokeConnection(id);
    if (pendingId && pendingId !== id) revokeConnection(pendingId);
  });
}

export function revokeConfirmedRestore(id: string, pendingId?: string) {
  return withConnectionLock(async () => {
    if (pendingId && pendingId !== id) revokeConnection(pendingId);
    const selection = currentSelection();
    if (selection?.id !== id) return;
    if (!selection.confirmed && (await readStoredConnection())?.id !== id)
      return;
    revokeConnection(id);
  });
}

export function queueConnectionRevocation(id: string) {
  return navigator.locks.request(marker, () => revokeConnection(id));
}

export function hasUnfinishedRevocation() {
  try {
    const selection = localStorage.getItem(marker);
    return (
      selection?.startsWith("~") ||
      selection?.startsWith("-") ||
      (!!currentSelection() && !restorableSelection())
    );
  } catch {
    return false;
  }
}

export async function finishForgettingConnection() {
  let selection: string | null;
  try {
    selection = localStorage.getItem(marker);
  } catch {
    return;
  }
  if (!selection || !canRememberConnection()) return;
  const current = currentSelection();
  if (current && !restorableSelection()) {
    await revokeRememberedConnection(current.id);
    selection = localStorage.getItem(marker);
  }
  await withStorageDeadline(undefined, (signal) =>
    accessStorage(
      "readwrite",
      (store) => {
        const request = store.get(slot);
        request.onsuccess = () => {
          if (request.result && request.result.id !== restorableSelection()?.id)
            store.delete(slot);
        };
        return request;
      },
      { signal },
    ),
  );
  if (selection?.startsWith("-") || selection?.startsWith("~")) {
    const handled = selection;
    await withConnectionLock(() => {
      if (localStorage.getItem(marker) !== handled) return;
      if (handled.startsWith("-")) localStorage.removeItem(marker);
      else localStorage.setItem(marker, "?" + handled.slice(1));
    });
  }
}
