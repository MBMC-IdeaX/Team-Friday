// Local-first storage: anything that must survive a dead network lands here
// BEFORE any fetch. The panic button writes to `outbox` first and tells the
// guardians second — that ordering is the whole reason SOS fires offline.
//
// ponytail: no `idb` wrapper package and no Background Sync. The platform API is
// ~30 lines for the four operations we need, and Background Sync is Chromium-only
// (no Safari, no Firefox) — an `online` listener is shorter and cross-browser.

const DB_NAME = "herguardian";
const DB_VERSION = 1;

export const STORES = ["outbox", "guardians", "recordings"] as const;
export type Store = (typeof STORES)[number];

export type OutboxItem = { id?: number; url: string; body: string; createdAt: number };
export type Guardian = { id?: number; name: string; phone: string };
// Audio chunks, not one long file. MediaRecorder dies whenever the OS suspends
// the page, and a single 20-minute blob that never got written is worth nothing —
// a 10s chunk written before the suspension is evidence that survives.
export type Recording = { id?: number; sessionId: string; blob: Blob; createdAt: number };

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
        const req = fn(db.transaction(store, mode).objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const idbPut = <T,>(store: Store, value: T): Promise<IDBValidKey> =>
  tx(store, "readwrite", (s) => s.add(value));
export const idbAll = <T,>(store: Store): Promise<T[]> => tx<T[]>(store, "readonly", (s) => s.getAll());
export const idbDel = (store: Store, key: IDBValidKey): Promise<undefined> =>
  tx(store, "readwrite", (s) => s.delete(key));

// -- outbox -----------------------------------------------------------------

export async function queueRequest(url: string, body: unknown): Promise<void> {
  await idbPut("outbox", {
    url,
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
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: item.body,
  });
  return res.ok;
}

export async function flushOutbox(): Promise<number> {
  const items = (await idbAll<OutboxItem>("outbox")).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  const sent = await drain(items, post);
  await Promise.all(sent.flatMap((i) => (i.id == null ? [] : [idbDel("outbox", i.id)])));
  return sent.length;
}

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