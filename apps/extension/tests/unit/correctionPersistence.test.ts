import { describe, expect, it, vi } from 'vitest';

import { CorrectionPersistence } from '@/runtime/CorrectionPersistence';
import type { BackgroundMessage } from '@/shared/messages/protocol';

const input = { host: 'example', label: '姓名', controlKind: 'text' as const, kind: 'MANUAL_EDIT' as const };

describe('correction delta client', () => {
  it('只发送新事件，旧加载和旧应答不会覆盖清空后的世代', async () => {
    let releaseLoad: ((value: unknown) => void) | undefined;
    let releaseAppend: ((value: unknown) => void) | undefined;
    const send = vi.fn(async (message: BackgroundMessage) => {
      if (message.type === 'LOAD_CORRECTIONS') return new Promise((resolve) => { releaseLoad = resolve; });
      return new Promise((resolve) => { releaseAppend = resolve; });
    });
    const client = new CorrectionPersistence(send);
    const loading = client.load(); client.observeEpoch('new');
    releaseLoad!({ ok: true, snapshot: { epoch: 'old', records: [] } }); await loading;
    const recording = client.record(input);
    expect(send.mock.calls[1]?.[0]).toMatchObject({ type: 'APPEND_CORRECTION', epoch: 'new', record: input });
    expect(send.mock.calls[1]?.[0]).not.toHaveProperty('records');
    client.observeEpoch('newest'); releaseAppend!({ ok: true, snapshot: { epoch: 'new', records: [] } }); await recording;
    const next = client.record(input);
    expect(send.mock.calls[2]?.[0]).toMatchObject({ epoch: 'newest' }); releaseAppend!({ ok: true }); await next;
  });
  it('报告过期或持久化失败，不把旧记录重新绑定到新世代发送', async () => {
    const send = vi.fn(async () => ({ ok: true, stale: true, snapshot: { epoch: 'new', records: [] } }));
    const client = new CorrectionPersistence(send); client.observeEpoch('old');
    expect(await client.record(input)).toBe(false); expect(send).toHaveBeenCalledTimes(1);
    send.mockRejectedValueOnce(new Error('quota')); expect(await client.record(input)).toBe(false);
  });
});
