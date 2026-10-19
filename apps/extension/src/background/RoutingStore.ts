import type {
  CacheMutation, FingerprintEntry, MappingMemoryEntry, MappingMemoryInput, MemoryMutation, RoutingFieldContext, RoutingSnapshot,
} from '@/shared/contracts/routing';
import { cacheKeyOf, FingerprintCache } from '@/router/FingerprintCache';
import { MappingMemory, memoryKeyOf } from '@/memory/MappingMemory';
import { entryPathInfo, isRouteContextValid, learnableRoute } from '@/router/RouteContext';

const CACHE = 'atsMappings';
const MEMORY = 'mappingMemory';
const META = 'metadata';
const RECEIPTS = 'receipts';
const STORES = [CACHE, MEMORY, META, RECEIPTS];
const LEGACY_CACHE = 'applyfill.fingerprintCache';
const MAX_ENTRIES = 500;
const KINDS = new Set(['text', 'textarea', 'number', 'email', 'tel', 'url', 'search', 'select', 'checkbox', 'radio', 'date', 'combobox']);
const SECTIONS = new Set(['basic', 'education', 'work', 'project', 'skills', 'essay', 'attachment', 'unknown']);

interface StoredEntry<T> { key: string; input: RoutingFieldContext; entry: T; order: number }
interface Receipt { id: string; order: number }
type LegacyStorage = Pick<chrome.storage.StorageArea, 'get' | 'remove'>;

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error('ROUTING_REQUEST_FAILED'));
  });
}

function inputOf(raw: unknown, host?: string): MappingMemoryInput {
  if (!raw || typeof raw !== 'object') throw new Error('INVALID_ROUTING_CONTEXT');
  const input = raw as MappingMemoryInput;
  if (typeof input.host !== 'string' || input.host.length > 255 || !input.host || (host !== undefined && input.host !== host) ||
    !SECTIONS.has(input.sectionType) || !KINDS.has(input.controlKind) || typeof input.normalizedLabel !== 'string' ||
    input.normalizedLabel.length > 500 || (input.context !== undefined && (typeof input.context !== 'string' || input.context.length > 128)) ||
    (input.boundEntryIndex !== undefined && (!Number.isSafeInteger(input.boundEntryIndex) || input.boundEntryIndex < 0))) throw new Error('INVALID_ROUTING_CONTEXT');
  return { host: input.host, sectionType: input.sectionType, normalizedLabel: input.normalizedLabel, controlKind: input.controlKind,
    ...(input.context !== undefined ? { context: input.context } : {}),
    ...(input.boundEntryIndex !== undefined ? { boundEntryIndex: input.boundEntryIndex } : {}) };
}

function cachePathValid(path: string, input: RoutingFieldContext): boolean {
  const entry = entryPathInfo(path);
  return (!entry || entry.index === '{index}') && isRouteContextValid(path, input.sectionType, 0);
}

function legacyInput(key: string, memory: boolean): MappingMemoryInput | undefined {
  try {
    if (memory) {
      const parts = JSON.parse(key) as unknown[];
      if (!Array.isArray(parts) || parts.length !== 6 || parts[0] !== 2) return undefined;
      return inputOf({ host: parts[1], sectionType: parts[2], normalizedLabel: parts[3], controlKind: parts[4], context: parts[5] });
    }
    const parts = /^2::(.+?)::(basic|education|work|project|skills|essay|attachment|unknown)::(.*)::([a-z]+)::([^:]*)$/.exec(key);
    return parts ? inputOf({ host: parts[1], sectionType: parts[2], normalizedLabel: parts[3], controlKind: parts[4], context: parts[5] }) : undefined;
  } catch { return undefined; }
}

// All long-lived route metadata is owned by the extension origin. A content
// script never opens page-origin IndexedDB or replaces another frame's snapshot.
export class RoutingStore {
  private database?: Promise<IDBDatabase>;
  private migration?: Promise<void>;

  constructor(private readonly legacy?: LegacyStorage, private readonly databaseName = 'applyfill-routing',
    private readonly now: () => number = () => Date.now(), private readonly maxEntries = MAX_ENTRIES) {}

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const opening = indexedDB.open(this.databaseName, 1);
        opening.onupgradeneeded = () => {
          for (const name of [CACHE, MEMORY]) {
            const store = opening.result.createObjectStore(name, { keyPath: 'key' });
            store.createIndex('host', 'input.host');
          }
          opening.result.createObjectStore(META);
          opening.result.createObjectStore(RECEIPTS, { keyPath: 'id' });
        };
        opening.onsuccess = () => {
          const db = opening.result;
          db.onversionchange = () => { db.close(); this.database = undefined; this.migration = undefined; };
          resolve(db);
        };
        opening.onerror = () => reject(opening.error ?? new Error('ROUTING_DATABASE_FAILED'));
      });
      void this.database.catch(() => { this.database = undefined; });
    }
    return this.database;
  }

  private async transaction<T>(names: string[], mode: IDBTransactionMode, operation: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let result: T;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error('ROUTING_TRANSACTION_ABORTED'));
      tx.onerror = () => reject(tx.error ?? new Error('ROUTING_TRANSACTION_FAILED'));
      void operation(tx).then((value) => { result = value; }, (error) => {
        try { tx.abort(); } catch { /* Already aborted. */ }
        reject(error);
      });
    });
  }

  private async prune(tx: IDBTransaction, name: string): Promise<void> {
    const store = tx.objectStore(name);
    const entries = await request<Array<StoredEntry<unknown>>>(store.getAll());
    entries.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
    for (const entry of entries.slice(0, Math.max(0, entries.length - this.maxEntries))) store.delete(entry.key);
  }

  async ready(): Promise<void> {
    if (!this.migration) {
      this.migration = (async () => {
        const legacy = this.legacy ? await this.legacy.get([LEGACY_CACHE, MappingMemory.STORAGE_KEY]) : {};
        await this.transaction(STORES, 'readwrite', async (tx) => {
          const meta = tx.objectStore(META);
          if (await request(meta.get('migrated.v1'))) return;
          const cache = new FingerprintCache(); cache.loadFromJSON(legacy[LEGACY_CACHE]);
          const memory = new MappingMemory(); memory.loadFromJSON(legacy[MappingMemory.STORAGE_KEY]);
          let order = Number(await request(meta.get('order'))) || 0;
          for (const [key, entry] of cache.toJSON().entries) {
            const input = legacyInput(key, false);
            if (input && cacheKeyOf(input) === key && cachePathValid(entry.targetPathTemplate, input) &&
              Number.isSafeInteger(entry.hits) && entry.hits > 0 && entry.verifiedAt >= 0 &&
              !await request(tx.objectStore(CACHE).get(key))) {
              tx.objectStore(CACHE).put({ key, input, entry, order: ++order });
            }
          }
          for (const [key, entry] of memory.toJSON().entries) {
            const input = legacyInput(key, true);
            if (input && memoryKeyOf(input) === key && learnableRoute(entry.targetPath, input.sectionType, 0) === entry.targetPath &&
              !await request(tx.objectStore(MEMORY).get(key))) {
              tx.objectStore(MEMORY).put({ key, input, entry, order: ++order });
            }
          }
          await this.prune(tx, CACHE); await this.prune(tx, MEMORY);
          meta.put(order, 'order'); meta.put(true, 'migrated.v1');
        });
        // Delete only after the IDB commit. A crash before cleanup cannot import
        // a stale snapshot again, because the migration marker is transactional.
        if (this.legacy) await this.legacy.remove([LEGACY_CACHE, MappingMemory.STORAGE_KEY, 'applyfill.mappingMemory.v1']);
      })();
      void this.migration.catch(() => { this.migration = undefined; });
    }
    return this.migration;
  }

  async load(host: string): Promise<RoutingSnapshot> {
    await this.ready();
    return this.transaction([CACHE, MEMORY], 'readonly', async (tx) => {
      const cache = await request<Array<StoredEntry<FingerprintEntry>>>(tx.objectStore(CACHE).index('host').getAll(host));
      const memory = await request<Array<StoredEntry<MappingMemoryEntry>>>(tx.objectStore(MEMORY).index('host').getAll(host));
      return { cache: { schemaVersion: 2, entries: cache.map((item) => [item.key, item.entry]) },
        memory: { schemaVersion: 2, entries: memory.map((item) => [item.key, item.entry]) } };
    });
  }

  async apply(host: string, batchId: string, rawCache: unknown, rawMemory: unknown, assertActive: () => void = () => undefined): Promise<void> {
    if (!/^routing_[a-zA-Z0-9_-]{1,100}$/.test(batchId) || !Array.isArray(rawCache) || !Array.isArray(rawMemory) ||
      rawCache.length + rawMemory.length > 2000) throw new Error('INVALID_ROUTING_BATCH');
    const cache = rawCache.map((raw): CacheMutation => {
      if (!raw || typeof raw !== 'object') throw new Error('INVALID_CACHE_MUTATION');
      const { boundEntryIndex: _boundEntryIndex, ...input } = inputOf(raw.input, host);
      if (raw.kind === 'invalidate') return { kind: 'invalidate', input };
      if (raw.kind !== 'record' || typeof raw.targetPathTemplate !== 'string' || !cachePathValid(raw.targetPathTemplate, input)) throw new Error('INVALID_CACHE_PATH');
      return { kind: 'record', input, targetPathTemplate: raw.targetPathTemplate };
    });
    const memory = rawMemory.map((raw): MemoryMutation => {
      if (!raw || typeof raw !== 'object') throw new Error('INVALID_MEMORY_MUTATION');
      const input = inputOf(raw.input, host);
      if (raw.kind === 'invalidate') return { kind: 'invalidate', input };
      if ((raw.kind !== 'user' && raw.kind !== 'verified') || typeof raw.targetPath !== 'string' || raw.targetPath.length > 200) throw new Error('INVALID_MEMORY_PATH');
      return { kind: raw.kind, input, targetPath: raw.targetPath };
    });
    await this.ready();
    await this.transaction(STORES, 'readwrite', async (tx) => {
      assertActive();
      const receipts = tx.objectStore(RECEIPTS);
      const receiptId = JSON.stringify([host, batchId]);
      if (await request(receipts.get(receiptId))) return;
      const meta = tx.objectStore(META);
      let order = Number(await request(meta.get('order'))) || 0;
      for (const mutation of cache) {
        assertActive();
        const store = tx.objectStore(CACHE);
        const key = cacheKeyOf(mutation.input);
        if (mutation.kind === 'invalidate') { store.delete(key); continue; }
        const old = await request<StoredEntry<FingerprintEntry> | undefined>(store.get(key));
        assertActive();
        store.put({ key, input: mutation.input, order: ++order,
          entry: { targetPathTemplate: mutation.targetPathTemplate, hits: (old?.entry.hits ?? 0) + 1, verifiedAt: this.now() } });
      }
      for (const mutation of memory) {
        assertActive();
        const store = tx.objectStore(MEMORY);
        const key = memoryKeyOf(mutation.input);
        if (mutation.kind === 'invalidate') { store.delete(key); continue; }
        const path = learnableRoute(mutation.targetPath, mutation.input.sectionType, mutation.input.boundEntryIndex);
        if (!path) { if (mutation.kind === 'user') store.delete(key); continue; }
        const old = await request<StoredEntry<MappingMemoryEntry> | undefined>(store.get(key));
        assertActive();
        const preserve = mutation.kind === 'verified' && old?.entry.source === 'user';
        const { boundEntryIndex: _boundEntryIndex, ...input } = mutation.input;
        store.put({ key, input, order: ++order, entry: { targetPath: preserve ? old.entry.targetPath : path,
          source: preserve ? 'user' : mutation.kind === 'user' ? 'user' : 'verified', hits: (old?.entry.hits ?? 0) + 1, updatedAt: this.now() } });
      }
      await this.prune(tx, CACHE); await this.prune(tx, MEMORY);
      receipts.put({ id: receiptId, order: ++order });
      const previous = await request<Receipt[]>(receipts.getAll());
      previous.sort((a, b) => a.order - b.order);
      for (const receipt of previous.slice(0, Math.max(0, previous.length - 1024))) receipts.delete(receipt.id);
      meta.put(order, 'order');
      assertActive();
    });
  }

  async close(): Promise<void> { if (this.database) (await this.database).close(); this.database = undefined; this.migration = undefined; }
}
