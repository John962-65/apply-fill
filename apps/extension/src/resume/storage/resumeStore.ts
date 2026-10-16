import type { CompiledResume } from '@/shared/contracts/resume';

const DB_NAME = 'applyfill';
const DB_VERSION = 1;
const STORE_NAME = 'resumes';
const CURRENT_KEY = 'current';

let dbPromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise !== undefined) {
    return dbPromise;
  }
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
  });
  return dbPromise;
}

function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const request = operation(tx.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('indexedDB operation failed'));
      }),
  );
}

export function saveCompiledResume(document: CompiledResume): Promise<void> {
  return withStore('readwrite', (store) => store.put(document, CURRENT_KEY)).then(() => undefined);
}

export function loadCompiledResume(): Promise<CompiledResume | null> {
  return withStore<CompiledResume | undefined>('readonly', (store) => store.get(CURRENT_KEY)).then(
    (value) => value ?? null,
  );
}

export function clearCompiledResume(): Promise<void> {
  return withStore('readwrite', (store) => store.delete(CURRENT_KEY)).then(() => undefined);
}
