import type { FingerprintCache } from '@/router/FingerprintCache';
import type { MappingMemory } from '@/memory/MappingMemory';
import type { CacheMutation, MemoryMutation, RoutingLoadResponse } from '@/shared/contracts/routing';
import type { BackgroundMessage, SimpleAck } from '@/shared/messages/protocol';
import { sendToBackground } from '@/shared/messages/client';
import { createId } from '@/shared/utils/id';
import { withAbort } from '@/shared/utils/timing';

interface PendingBatch { runId: string; id: string; cache: CacheMutation[]; memory: MemoryMutation[] }

export class RoutingPersistence {
  private batch?: PendingBatch;
  private pending: Promise<boolean> = Promise.resolve(true);

  constructor(private readonly cache: FingerprintCache, private readonly memory: MappingMemory,
    private readonly send: (message: BackgroundMessage) => Promise<unknown> = sendToBackground) {}

  async load(runId: string, signal?: AbortSignal): Promise<boolean> {
    // Failed or cancelled reads must not leave a previous document's view in use.
    this.cache.clear(); this.memory.clear(); this.batch = undefined;
    try {
      const response = await withAbort(this.send({ type: 'LOAD_ROUTING', runId }), this.bounded(signal)) as RoutingLoadResponse;
      if (!response?.ok || !response.snapshot) return false;
      this.cache.loadFromJSON(response.snapshot.cache); this.memory.loadFromJSON(response.snapshot.memory);
      return true;
    } catch { return false; }
  }

  flush(runId: string, signal?: AbortSignal): Promise<boolean> {
    const operation = this.pending.catch(() => false).then(() => this.flushNow(runId, signal));
    this.pending = operation;
    return operation;
  }

  private async flushNow(runId: string, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    if (!this.batch) this.batch = { runId, id: createId('routing'), cache: this.cache.pendingMutations(), memory: this.memory.pendingMutations() };
    const batch = this.batch;
    if (batch.runId !== runId) return false;
    if (batch.cache.length + batch.memory.length === 0) { this.batch = undefined; return true; }
    try {
      const response = await withAbort(this.send({ type: 'FLUSH_ROUTING', runId, batchId: batch.id,
        cache: batch.cache, memory: batch.memory }), this.bounded(signal)) as SimpleAck;
      if (!response?.ok || this.batch !== batch || signal?.aborted) return false;
      this.cache.acknowledgeMutations(batch.cache.length); this.memory.acknowledgeMutations(batch.memory.length);
      this.batch = undefined;
      return true;
    } catch { return false; }
  }

  private bounded(signal?: AbortSignal): AbortSignal {
    return signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000);
  }
}
