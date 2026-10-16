import { describe, expect, it } from 'vitest';

import { BatchLLMRouter } from '@/router/BatchLLMRouter';
import type { UnmappedFieldRef } from '@/router/BatchLLMRouter';
import { FingerprintCache } from '@/router/FingerprintCache';

function ref(fieldKey: string): UnmappedFieldRef {
  return { fieldKey, label: fieldKey, controlKind: 'text', sectionType: 'basic' };
}

describe('FingerprintCache', () => {
  it('记录并读取路径模板', () => {
    const cache = new FingerprintCache(() => 100);
    cache.record(
      { host: 'a.com', sectionType: 'education', normalizedLabel: ' 学校名称 ', controlKind: 'text' },
      'education[{index}].school',
    );
    const hit = cache.get({
      host: 'a.com',
      sectionType: 'education',
      normalizedLabel: '学校名称',
      controlKind: 'text',
    });
    expect(hit?.targetPathTemplate).toBe('education[{index}].school');
    expect(hit?.hits).toBe(1);
    expect(hit?.verifiedAt).toBe(100);
  });

  it('重复记录累计命中次数', () => {
    const cache = new FingerprintCache();
    const input = { host: 'a.com', sectionType: 'basic' as const, normalizedLabel: '姓名', controlKind: 'text' as const };
    cache.record(input, 'basic.name');
    cache.record(input, 'basic.name');
    expect(cache.get(input)?.hits).toBe(2);
  });

  it('区分不同主机与区块', () => {
    const cache = new FingerprintCache();
    cache.record({ host: 'a.com', sectionType: 'basic', normalizedLabel: '姓名', controlKind: 'text' }, 'basic.name');
    expect(
      cache.get({ host: 'b.com', sectionType: 'basic', normalizedLabel: '姓名', controlKind: 'text' }),
    ).toBeUndefined();
  });

  it('超出容量时淘汰最早条目', () => {
    const cache = new FingerprintCache(() => 0, 2);
    cache.record({ host: 'a', sectionType: 'basic', normalizedLabel: 'a', controlKind: 'text' }, 'p1');
    cache.record({ host: 'a', sectionType: 'basic', normalizedLabel: 'b', controlKind: 'text' }, 'p2');
    cache.record({ host: 'a', sectionType: 'basic', normalizedLabel: 'c', controlKind: 'text' }, 'p3');
    expect(cache.size).toBe(2);
    expect(cache.get({ host: 'a', sectionType: 'basic', normalizedLabel: 'a', controlKind: 'text' })).toBeUndefined();
    expect(cache.get({ host: 'a', sectionType: 'basic', normalizedLabel: 'c', controlKind: 'text' })).toBeDefined();
  });

  it('可序列化并恢复', () => {
    const cache = new FingerprintCache();
    cache.record({ host: 'a', sectionType: 'basic', normalizedLabel: '姓名', controlKind: 'text' }, 'basic.name');
    const restored = new FingerprintCache();
    restored.loadFromJSON(cache.toJSON());
    expect(restored.get({ host: 'a', sectionType: 'basic', normalizedLabel: '姓名', controlKind: 'text' })?.targetPathTemplate).toBe(
      'basic.name',
    );
    restored.loadFromJSON(undefined);
    expect(restored.size).toBe(1);
  });
});

describe('BatchLLMRouter', () => {
  it('未配置解析器时返回空结果', async () => {
    const router = new BatchLLMRouter();
    expect(router.enabled).toBe(false);
    const result = await router.route([ref('a')]);
    expect(result.size).toBe(0);
  });

  it('按批量大小分批调用解析器', async () => {
    const calls: number[] = [];
    const router = new BatchLLMRouter(
      async (batch) => {
        calls.push(batch.length);
        return batch.map((field) => ({ fieldKey: field.fieldKey, targetPathTemplate: 'basic.name', confidence: 0.9 }));
      },
      { batchSize: 2 },
    );
    const result = await router.route([ref('a'), ref('b'), ref('c')]);
    expect(calls).toEqual([2, 1]);
    expect(result.size).toBe(3);
  });

  it('过滤低置信度提议', async () => {
    const router = new BatchLLMRouter(async (batch) =>
      batch.map((field, index) => ({
        fieldKey: field.fieldKey,
        targetPathTemplate: 'basic.name',
        confidence: index === 0 ? 0.9 : 0.5,
      })),
    );
    const result = await router.route([ref('a'), ref('b')]);
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(false);
  });

  it('忽略批外字段的提议', async () => {
    const router = new BatchLLMRouter(async () => [
      { fieldKey: 'other', targetPathTemplate: 'basic.name', confidence: 0.9 },
    ]);
    const result = await router.route([ref('a')]);
    expect(result.size).toBe(0);
  });
});
