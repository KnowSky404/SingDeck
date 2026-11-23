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
const rejectedPrefix = `${marker}.rejected.`;
const storeName = "connections";
const slot = "active";

function withConnectionLock<T>(action: () => T) {
  return navigator.locks.request(
    marker,
    { signal: AbortSignal.timeout(3000) },
    action,
  );
}

export function canRememberConnection() {
  return !!(
    globalThis.crypto?.subtle &&
    globalThis.indexedDB &&
    navigator.locks
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
  if (!canRememberConnection()) return;
  await withConnectionLock(() => {
    revokeConnection(currentSelection()?.id);
    if (id) localStorage.setItem(marker, "?" + id);
  });
}

function currentSelection(): RememberedSelection | null {
  const value = localStorage.getItem(marker);
  if (!value || (value[0] !== "+" && value[0] !== "?")) return null;
  return { id: value.slice(1), confirmed: value[0] === "+" };
}

function restorableSelection() {
  const selection = currentSelection();
  return selection && !localStorage.getItem(rejectedPrefix + selection.id)
    ? selection
    : null;
}

export function markRejectedConnection(id: string) {
  try {
    if (currentSelection()?.id === id)
      localStorage.setItem(rejectedPrefix + id, "1");
    return true;
  } catch {
    return false;
  }
}

function confirmConnection(id: string) {
  try {
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
          reject(signal?.reason);
          try {
            transaction.abort();
          } catch {
            // The transaction can already have finished when cancellation arrives.
          }
        };
        signal?.addEventListener("abort", abort, { once: true });
        transaction.oncomplete = () => {
          signal?.removeEventListener("abort", abort);
          resolve(request?.result);
        };
        transaction.onabort = () => {
          signal?.removeEventListener("abort", abort);
          reject(transaction.error);
        };
      };
      // Schedule the write under the lock without holding it during IndexedDB I/O.
      if (locked) void withConnectionLock(start).catch(reject);
      else start();
    });
  } finally {
    db.close();
  }
}

async function readStoredConnection(signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(3000);
  const scope = new AbortController();
  const cancel = () => scope.abort(signal?.reason);
  const timeOut = () => scope.abort(deadline.reason);
  signal?.throwIfAborted();
  signal?.addEventListener("abort", cancel, { once: true });
  deadline.addEventListener("abort", timeOut, { once: true });
  try {
    return await accessStorage<RememberedConnection>(
      "readonly",
      (store) => store.get(slot),
      { signal: scope.signal },
    );
  } finally {
    signal?.removeEventListener("abort", cancel);
    deadline.removeEventListener("abort", timeOut);
  }
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
  if (restorableSelection()?.id !== id) return;
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
  const written = await accessStorage(
    "readwrite",
    (store) => {
      const latest = loadProfiles().find((saved) => saved.id === profile.id);
      if (
        signal.aborted ||
        restorableSelection()?.id !== id ||
        latest?.endpoint !== profile.endpoint
      )
        return;
      return store.put(saved, slot);
    },
    { locked: true },
  );
  if (written === undefined) return;
  await withConnectionLock(() => {
    if (!signal.aborted && restorableSelection()?.id === id)
      confirmConnection(id);
  }).catch(() => {
    // The credential has committed and can be restored even if confirmation times out.
  });
}

function revokeConnection(id?: string) {
  if (!id) return;
  if (currentSelection()?.id === id) {
    // A same-size marker revokes reconnect immediately and survives an interrupted delete.
    localStorage.setItem(marker, "-" + id);
  }
  localStorage.removeItem(rejectedPrefix + id);
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
  await accessStorage("readwrite", (store) => {
    const request = store.get(slot);
    request.onsuccess = () => {
      if (request.result && request.result.id !== restorableSelection()?.id)
        store.delete(slot);
    };
    return request;
  });
  if (selection?.startsWith("-")) {
    await withConnectionLock(() => {
      if (localStorage.getItem(marker) === selection)
        localStorage.removeItem(marker);
    });
  }
}
