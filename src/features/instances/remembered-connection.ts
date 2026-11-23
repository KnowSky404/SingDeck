import { loadProfiles, type Profile } from "./profiles";

interface RememberedConnection {
  id: string;
  profileId: string;
  endpoint: string;
  key: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}

const marker = "singdeck.remembered-connection";
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
    return canRememberConnection() ? currentSelection() : null;
  } catch {
    return null;
  }
}

export async function claimRememberedConnection(id?: string) {
  if (!canRememberConnection()) return;
  await withConnectionLock(() => {
    if (id) localStorage.setItem(marker, "?" + id);
    else revokeConnection(currentSelection()?.id);
  });
}

function currentSelection() {
  const value = localStorage.getItem(marker);
  if (!value || (value[0] !== "+" && value[0] !== "?")) return null;
  return { id: value.slice(1), confirmed: value[0] === "+" };
}

function confirmConnection(id: string) {
  try {
    localStorage.setItem(marker, "+" + id);
  } catch {
    // A matching IndexedDB record can still be restored with its pending selection.
  }
}

function openStorage() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(marker, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function accessStorage<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T> | undefined,
  locked = false,
) {
  const db = await openStorage();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const start = () => {
        const transaction = db.transaction(storeName, mode);
        const request = operation(transaction.objectStore(storeName));
        transaction.oncomplete = () => resolve(request?.result);
        transaction.onabort = () => reject(transaction.error);
      };
      // Schedule the write under the lock without holding it during IndexedDB I/O.
      if (locked) void withConnectionLock(start).catch(reject);
      else start();
    });
  } finally {
    db.close();
  }
}

function binding(id: string, profile: Profile) {
  return new TextEncoder().encode(
    JSON.stringify([id, profile.id, profile.endpoint]),
  );
}

export async function restoreConnection(
  profiles: Profile[],
  { id, confirmed }: { id: string; confirmed: boolean },
  signal: AbortSignal,
  onCredential: () => void,
) {
  if (!(await withConnectionLock(() => currentSelection()?.id === id))) return;
  const saved: RememberedConnection | undefined = await accessStorage(
    "readonly",
    (store) => store.get(slot),
  );
  // An opted-in connection may still be awaiting verification and have no credential.
  if (saved?.id !== id) {
    if (confirmed && currentSelection()?.id === id)
      throw new Error("Remembered credential unavailable.");
    return;
  }
  signal.throwIfAborted();
  onCredential();
  const profile = profiles.find((profile) => profile.id === saved.profileId);
  if (!profile || profile.endpoint !== saved.endpoint) {
    if (await withConnectionLock(() => currentSelection()?.id === id))
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
    if (currentSelection()?.id !== id) return;
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
  if (currentSelection()?.id !== id) return;
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
        currentSelection()?.id !== id ||
        latest?.endpoint !== profile.endpoint
      )
        return;
      return store.put(saved, slot);
    },
    true,
  );
  if (written === undefined) return;
  await withConnectionLock(() => {
    if (!signal.aborted && currentSelection()?.id === id) confirmConnection(id);
  }).catch(() => {
    // The credential has committed and can be restored even if confirmation times out.
  });
}

function revokeConnection(id?: string) {
  if (!id) return;
  if (currentSelection()?.id !== id) return;
  // A same-size marker revokes reconnect immediately and survives an interrupted delete.
  localStorage.setItem(marker, "-" + id);
}

export function revokeRememberedConnection(id: string, pendingId?: string) {
  return withConnectionLock(() => {
    revokeConnection(id);
    if (pendingId && pendingId !== id) revokeConnection(pendingId);
  });
}

export function revokeConfirmedRestore(id: string) {
  return withConnectionLock(async () => {
    const selection = currentSelection();
    if (selection?.id !== id) return;
    if (!selection.confirmed) {
      const deadline = AbortSignal.timeout(3000);
      const saved: RememberedConnection | undefined = await Promise.race([
        accessStorage("readonly", (store) => store.get(slot)),
        new Promise<never>((_, reject) => {
          deadline.addEventListener("abort", () => reject(deadline.reason), {
            once: true,
          });
        }),
      ]);
      deadline.throwIfAborted();
      if (saved?.id !== id) return;
    }
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
  await accessStorage("readwrite", (store) => {
    const request = store.get(slot);
    request.onsuccess = () => {
      if (request.result && request.result.id !== currentSelection()?.id)
        store.delete(slot);
    };
    return request;
  });
  if (selection.startsWith("-")) {
    await withConnectionLock(() => {
      if (localStorage.getItem(marker) === selection)
        localStorage.removeItem(marker);
    });
  }
}
