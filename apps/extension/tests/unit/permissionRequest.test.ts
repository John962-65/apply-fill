import { afterEach, describe, expect, it, vi } from 'vitest';

import { PERMISSION_REQUEST_TIMEOUT_MS, requestPermissionWithTimeout } from '@/shared/utils/permissions';

afterEach(() => {
  vi.useRealTimers();
});

describe('requestPermissionWithTimeout', () => {
  it('透传成功结果', async () => {
    await expect(requestPermissionWithTimeout(Promise.resolve(true))).resolves.toBe(true);
    await expect(requestPermissionWithTimeout(Promise.resolve(false))).resolves.toBe(false);
  });

  it('请求被拒绝时返回 false 而不抛出', async () => {
    await expect(requestPermissionWithTimeout(Promise.reject(new Error('denied')))).resolves.toBe(false);
  });

  it('请求悬挂（无用户手势弹窗）时超时返回 false', async () => {
    vi.useFakeTimers();
    const pending = new Promise<boolean>(() => undefined);
    const result = requestPermissionWithTimeout(pending);
    await vi.advanceTimersByTimeAsync(PERMISSION_REQUEST_TIMEOUT_MS + 1);
    await expect(result).resolves.toBe(false);
  });
});
