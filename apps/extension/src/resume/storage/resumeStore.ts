import type { CompiledResume, ResumeVersionInfo } from '@/shared/contracts/resume';
import { RESUME_COMPILER_VERSION, RESUME_SCHEMA_VERSION } from '@/shared/contracts/resume';
import { migrateStoredResumeFacts } from './migrateStoredResume';
import { createId } from '@/shared/utils/id';
import { compileResume } from '../compiler/compile';

const DB_NAME = 'applyfill';
const DB_VERSION = 1;
const STORE_NAME = 'resumes';
const CURRENT_KEY = 'current';
const ACTIVE_KEY = 'activeVersion';
const VERSION_PREFIX = 'version:';
const MAX_VERSIONS = 20;
interface ResumeVersion extends Omit<ResumeVersionInfo, 'active'> { document: CompiledResume }

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
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); dbPromise = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
  });
  void dbPromise.catch(() => { dbPromise = undefined; });
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
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
        tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'));
        request.onerror = () => reject(request.error ?? new Error('indexedDB operation failed'));
      }),
  );
}

export function saveCompiledResume(document: CompiledResume, label?: string): Promise<void> {
  return withStore('readwrite', (store) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const versions = (request.result as unknown[]).filter(isVersion);
      if (!versions.length) {
        const previous = (request.result as CompiledResume[]).find((entry) => entry?.facts);
        if (previous) {
          const recovered = upgradeStored(previous);
          versions.push({ id: createId('resume'), label: `${recovered.normalized.basic.name || '待核对草稿'} · 原有版本`, createdAt: recovered.compiledAt, document: recovered });
        }
      }
      const createdAt = Math.max(Date.now(), ...versions.map((version) => version.createdAt + 1));
      const version: ResumeVersion = { id: createId('resume'), label: label?.trim().slice(0, 80) || `${document.normalized.basic.name || '待核对草稿'} · ${new Date(createdAt).toLocaleString()}`, createdAt, document };
      versions.push(version);
      versions.sort((a, b) => b.createdAt - a.createdAt);
      versions.forEach((entry, index) => { if (index < MAX_VERSIONS) store.put(entry, `${VERSION_PREFIX}${entry.id}`); else store.delete(`${VERSION_PREFIX}${entry.id}`); });
      store.put(document, CURRENT_KEY); store.put(version.id, ACTIVE_KEY);
    };
    return request;
  }).then(() => undefined);
}

function upgradeStored(value: CompiledResume): CompiledResume {
  if (value?.compilerVersion === RESUME_COMPILER_VERSION && value.schemaVersion === RESUME_SCHEMA_VERSION &&
    value.facts?.schemaVersion === RESUME_SCHEMA_VERSION && value.fillability !== undefined) {
    return value;
  }
  return compileResume(migrateStoredResumeFacts(value?.facts ?? value), Number.isFinite(value?.compiledAt) ? value.compiledAt : Date.now());
}

export function loadCompiledResume(): Promise<CompiledResume | null> {
  return withStore<CompiledResume | undefined>('readonly', (store) => store.get(CURRENT_KEY)).then(
    (value) => value === undefined ? null : upgradeStored(value),
  );
}

export function updateActiveCompiledResume(document: CompiledResume): Promise<void> {
  return withStore('readwrite', (store) => {
    const request = store.get(ACTIVE_KEY);
    request.onsuccess = () => {
      const activeId = request.result;
      store.put(document, CURRENT_KEY);
      if (typeof activeId === 'string') {
        const versionRequest = store.get(`${VERSION_PREFIX}${activeId}`);
        versionRequest.onsuccess = () => {
          const version = versionRequest.result as ResumeVersion | undefined;
          if (version !== undefined && isVersion(version)) {
            store.put({ ...version, document }, `${VERSION_PREFIX}${activeId}`);
          }
        };
      }
    };
    return request;
  }).then(() => undefined);
}

export function clearCompiledResume(): Promise<void> {
  return withStore('readwrite', (store) => store.clear()).then(() => undefined);
}

function isVersion(value: unknown): value is ResumeVersion {
  return !!value && typeof value === 'object' && 'document' in value && 'id' in value && typeof value.id === 'string' && 'createdAt' in value;
}

export async function listResumeVersions(): Promise<ResumeVersionInfo[]> {
  const values = await withStore('readonly', (store) => store.getAll()) as unknown[];
  const activeId = values.find((value) => typeof value === 'string');
  return values.filter(isVersion).sort((a, b) => b.createdAt - a.createdAt).map(({ id, label, createdAt }) => ({ id, label, createdAt, active: id === activeId }));
}

export async function activateResumeVersion(id: string): Promise<boolean> {
  let found = false;
  await withStore('readwrite', (store) => {
    const request = store.get(`${VERSION_PREFIX}${id}`);
    request.onsuccess = () => {
      if (!isVersion(request.result)) return;
      found = true; store.put(request.result.document, CURRENT_KEY); store.put(id, ACTIVE_KEY);
    };
    return request;
  });
  return found;
}

export async function deleteResumeVersion(id: string): Promise<boolean> {
  let deleted = false;
  await withStore('readwrite', (store) => {
    const request = store.get(ACTIVE_KEY);
    request.onsuccess = () => { if (request.result !== id) { store.delete(`${VERSION_PREFIX}${id}`); deleted = true; } };
    return request;
  });
  return deleted;
}
