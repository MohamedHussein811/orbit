// The person's own background image or video, kept in IndexedDB on this device.

const DB_NAME = "orbit-background";
const STORE = "media";
const KEY = "custom";
export const MAX_MEDIA_BYTES = 200 * 1024 * 1024;
export const MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/avif", "video/webm", "video/mp4"];

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export function saveCustomMedia(file: Blob): Promise<IDBValidKey> {
  return run("readwrite", (store) => store.put(file, KEY));
}

export async function loadCustomMedia(): Promise<Blob | null> {
  try {
    const value = await run<unknown>("readonly", (store) => store.get(KEY));
    return value instanceof Blob ? value : null;
  } catch {
    return null;
  }
}

export function removeCustomMedia(): Promise<undefined> {
  return run("readwrite", (store) => store.delete(KEY));
}
