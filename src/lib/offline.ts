// Local-first storage: anything that must survive a dead network lands here
// BEFORE any fetch. The panic button writes to `outbox` first and tells the
// guardians second — that ordering is the whole reason SOS fires offline.
//
// ponytail: no `idb` wrapper package and no Background Sync. The platform API is
// ~30 lines for the four operations we need, and Background Sync is Chromium-only
// (no Safari, no Firefox) — an `online` listener is shorter and cross-browser.

const DB_NAME = "herguardian";
const DB_VERSION = 2;

export const STORES = ["outbox", "guardians", "recordings", "device"] as const;
export type Store = (typeof STORES)[number];

export type OutboxItem = { id?: number; url: string; body: string; method?: "POST" | "PATCH"; createdAt: number };
export type Guardian = { id?: number; name: string; phone: string };
// Audio chunks, not one long file. MediaRecorder dies whenever the OS suspends
// the page, and a single 20-minute blob that never got written is worth nothing —
// a 10s chunk written before the suspension is evidence that survives.
export type Recording = { id?: number; sessionId: string; blob: Blob; createdAt: number };
// The account this device remembers. Stored here rather than in localStorage
// because IndexedDB is the browser's durable, structured store — the thing you
// would use SQLite for in a native app.
export type DeviceAccount = { id?: number; email: string; signedInAt: number };

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  // `indexedDB` is referenced inside the function on purpose: importing this
  // module under Node (for the drain test) must not touch it.
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, { keyPath: "id", autoIncrement: true });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(
  store: Store,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const req = fn(transaction.objectStore(store));
        transaction.oncomplete = () => resolve(req.result as T);
        transaction.onabort = () => reject(transaction.error ?? new Error("Storage transaction aborted"));
        transaction.onerror = () => reject(transaction.error ?? req.error);
      }),
  );
}

export const idbPut = <T,>(store: Store, value: T): Promise<IDBValidKey> =>
  tx(store, "readwrite", (s) => s.add(value));
export const idbAll = <T,>(store: Store): Promise<T[]> => tx<T[]>(store, "readonly", (s) => s.getAll());
export const idbDel = (store: Store, key: IDBValidKey): Promise<undefined> =>
  tx(store, "readwrite", (s) => s.delete(key));

// -- outbox -----------------------------------------------------------------

export async function queueRequest(url: string, body: unknown, method: "POST" | "PATCH" = "POST"): Promise<IDBValidKey> {
  return idbPut("outbox", {
    url,
    method,
    body: JSON.stringify(body),
    createdAt: Date.now(),
  } satisfies OutboxItem);
}

/** Pure. Ordered, and stops at the first failure — a queued SOS session must
 *  never overtake the thing it depends on. A thrown send counts as a failure:
 *  `fetch` rejects rather than returning 5xx when the network is simply gone. */
export async function drain<T>(
  items: T[],
  send: (item: T) => Promise<boolean>,
): Promise<T[]> {
  const sent: T[] = [];
  for (const item of items) {
    let ok = false;
    try {
      ok = await send(item);
    } catch {
      break;
    }
    if (!ok) break;
    sent.push(item);
  }
  return sent;
}

async function post(item: OutboxItem): Promise<boolean> {
  const res = await fetch(item.url, {
    method: item.method ?? "POST",
    headers: { "Content-Type": "application/json" },
    body: item.body,
  });
  return res.ok;
}

export const acknowledgeRequest = (key: IDBValidKey) => idbDel("outbox", key);

export async function deliverQueuedRequest(key: IDBValidKey | undefined, url: string,
  body: unknown, method: "POST" | "PATCH" = "POST"): Promise<boolean> {
  try {
    const ok = await post({ url, body: JSON.stringify(body), method, createdAt: Date.now() });
    if (ok && key !== undefined) await acknowledgeRequest(key).catch(() => {});
    return ok;
  } catch { return false; }
}

// Persist terminal intent before removing the locally active UUID.
export async function endSosSession(id: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Invalid SOS session");
  }
  const body = { id, status: "resolved" };
  const key = await queueRequest("/api/sos", body, "PATCH");
  if (activeSessionId() === id) clearActiveSession();
  return deliverQueuedRequest(key, "/api/sos", body, "PATCH");
}

let outboxFlight: Promise<number> | null = null;
export function flushOutbox(): Promise<number> {
  if (outboxFlight) return outboxFlight;
  outboxFlight = (async () => {
    const items = (await idbAll<OutboxItem>("outbox")).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    const sent = await drain(items, async (item) => {
      if (!await post(item)) return false;
      if (item.id != null) await acknowledgeRequest(item.id);
      return true;
    });
    return sent.length;
  })().finally(() => { outboxFlight = null; });
  return outboxFlight;
}

// -- device account ------------------------------------------------------------

export const saveDeviceAccount = (email: string) =>
  idbPut("device", { email, signedInAt: Date.now() } satisfies DeviceAccount);

export const getDeviceAccount = async (): Promise<DeviceAccount | null> => {
  const all = await idbAll<DeviceAccount>("device");
  return all.sort((a, b) => a.signedInAt - b.signedInAt).at(-1) ?? null;
};

export const clearDeviceAccount = async () => {
  const all = await idbAll<DeviceAccount>("device");
  await Promise.all(all.flatMap((a) => (a.id == null ? [] : [idbDel("device", a.id)])));
};

// -- recordings (S.7) ---------------------------------------------------------

export const saveRecording = (sessionId: string, blob: Blob) =>
  idbPut("recordings", { sessionId, blob, createdAt: Date.now() } satisfies Recording);
export const pendingRecordings = () => idbAll<Recording>("recordings");
export const dropRecording = (key: IDBValidKey) => idbDel("recordings", key);

async function sendRecording(r: Recording): Promise<boolean> {
  const form = new FormData();
  form.set("sessionId", r.sessionId);
  form.set("file", r.blob, "chunk.webm");
  const res = await fetch("/api/recording", { method: "POST", body: form });
  return res.ok;
}

/** Returns how many chunks are still on the device — the guardian view reads
 *  this as "evidence not yet uploaded", which is the honest number to show. */
export async function flushRecordings(): Promise<number> {
  const items = (await pendingRecordings()).sort((a, b) => a.id! - b.id!);
  let sent = 0;
  for (const r of items) {
    let ok = false;
    try {
      ok = await sendRecording(r);
    } catch {
      break; // offline: keep the chunks, try again on the next `online`
    }
    if (!ok) break;
    if (r.id != null) await idbDel("recordings", r.id);
    sent++;
  }
  return items.length - sent;
}

// -- active session -------------------------------------------------------------
//
// localStorage, not IndexedDB: this has to be readable synchronously on first
// render so the home screen knows whether to show SOS or "I'm safe" without a
// flash. The uuid doubles as the capability for /guard/<uuid>.

const ACTIVE_KEY = "hg:active-session";

export const activeSessionId = (): string | null =>
  typeof localStorage === "undefined" ? null : localStorage.getItem(ACTIVE_KEY);

export const setActiveSession = (id: string) => localStorage.setItem(ACTIVE_KEY, id);

export const clearActiveSession = () => localStorage.removeItem(ACTIVE_KEY);

// -- session id ---------------------------------------------------------------
// `crypto.randomUUID` is [SecureContext], so it is undefined on
// http://192.168.x.x — which is exactly how a phone opens a LAN demo. The SOS
// screen died on that, so build a v4 from getRandomValues instead, which is
// available on insecure origins.
export function newId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// -- guardians (stored on-device so SMS works with our whole stack offline) ---

export const saveGuardian = (g: Guardian) => idbPut("guardians", g);
export const listGuardians = () => idbAll<Guardian>("guardians");
export const removeGuardian = (key: IDBValidKey) => idbDel("guardians", key);
