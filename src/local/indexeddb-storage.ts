import type { PersistedCache, StorageDriver } from "./storage.types";

const DATABASE = "resourcekit";
const STORE = "caches";

/**
 * The default browser storage driver: the whole cache state under one
 * IndexedDB key. Outside the browser (SSR, tests) it quietly does
 * nothing, so the same engine config runs everywhere.
 */
export function indexedDbStorage(name: string): StorageDriver {
  if (typeof indexedDB === "undefined") {
    return { load: async () => null, save: async () => {} };
  }

  let database: Promise<IDBDatabase> | null = null;
  const open = () =>
    (database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));

  return {
    async load() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const request = db
          .transaction(STORE, "readonly")
          .objectStore(STORE)
          .get(name);
        request.onsuccess = () =>
          resolve((request.result as PersistedCache | undefined) ?? null);
        request.onerror = () => reject(request.error);
      });
    },

    async save(state) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, "readwrite");
        transaction.objectStore(STORE).put(state, name);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    },
  };
}
