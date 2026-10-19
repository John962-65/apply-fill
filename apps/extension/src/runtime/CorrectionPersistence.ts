import type { CorrectionResponse, UserCorrectionRecord } from '@/shared/contracts/context';
import type { BackgroundMessage } from '@/shared/messages/protocol';
import { sendToBackground } from '@/shared/messages/client';
import { createId } from '@/shared/utils/id';
import { withAbort } from '@/shared/utils/timing';

export class CorrectionPersistence {
  private epoch?: string;
  private revision = 0;
  constructor(private readonly send: (message: BackgroundMessage) => Promise<unknown> = sendToBackground) {}

  observeEpoch(epoch: unknown): void {
    if (typeof epoch === 'string' && epoch !== this.epoch) { this.epoch = epoch; this.revision += 1; }
  }
  async load(signal?: AbortSignal): Promise<void> {
    const revision = this.revision;
    try {
      const response = await withAbort(this.send({ type: 'LOAD_CORRECTIONS' }), this.bounded(signal)) as CorrectionResponse;
      if (response?.ok && revision === this.revision) this.observeEpoch(response.snapshot?.epoch);
    } catch { /* A later load can recover; no stale snapshot is ever written. */ }
  }
  async record(input: Omit<UserCorrectionRecord, 'id' | 'createdAt'>): Promise<boolean> {
    if (!this.epoch) await this.load();
    const epoch = this.epoch;
    if (!epoch) return false;
    const revision = this.revision;
    const record: UserCorrectionRecord = { ...input, id: createId('correction'), createdAt: Date.now() };
    try {
      const response = await withAbort(this.send({ type: 'APPEND_CORRECTION', epoch, record }), this.bounded()) as CorrectionResponse;
      if (response?.ok && revision === this.revision) this.observeEpoch(response.snapshot?.epoch);
      return response?.ok === true && response.stale !== true;
    } catch { return false; }
  }
  private bounded(signal?: AbortSignal): AbortSignal {
    return signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000);
  }
}
