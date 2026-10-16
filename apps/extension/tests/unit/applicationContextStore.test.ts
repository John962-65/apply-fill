import { describe, expect, it } from 'vitest';

import { ApplicationContextStore } from '@/jd/ApplicationContext';

const candidate = { title: '前端工程师', company: '示例科技', source: 'jsonld' as const, confidence: 'high' as const };

describe('ApplicationContextStore', () => {
  it('按主机保存并读取岗位上下文', () => {
    const store = new ApplicationContextStore(() => 1000);
    store.save(candidate, 'job.example.com', 'https://job.example.com/apply/1');
    const context = store.get('job.example.com');
    expect(context?.title).toBe('前端工程师');
    expect(context?.capturedAt).toBe(1000);
    expect(context?.expiresAt).toBe(1000 + 6 * 60 * 60 * 1000);
    expect(context?.url).toBe('https://job.example.com/apply/1');
  });

  it('同名主机重复嗅探覆盖旧上下文', () => {
    const store = new ApplicationContextStore();
    store.save(candidate, 'a.com', 'https://a.com/1');
    store.save({ ...candidate, title: '新岗位' }, 'a.com', 'https://a.com/2');
    expect(store.get('a.com')?.title).toBe('新岗位');
    expect(store.size).toBe(1);
  });

  it('超过有效期后读取返回 undefined 并清理', () => {
    let now = 1000;
    const store = new ApplicationContextStore(() => now, 500);
    store.save(candidate, 'a.com', 'https://a.com/1');
    expect(store.get('a.com')).toBeDefined();
    now = 1600;
    expect(store.get('a.com')).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('不同主机相互隔离', () => {
    const store = new ApplicationContextStore();
    store.save(candidate, 'a.com', 'https://a.com/1');
    expect(store.get('b.com')).toBeUndefined();
  });

  it('序列化往返一致并过滤非法条目', () => {
    const store = new ApplicationContextStore(() => 5);
    store.save(candidate, 'a.com', 'https://a.com/1');
    const restored = new ApplicationContextStore(() => 5);
    restored.loadFromJSON(JSON.parse(JSON.stringify(store.toJSON())));
    expect(restored.get('a.com')?.title).toBe('前端工程师');
    const polluted = new ApplicationContextStore();
    polluted.loadFromJSON({ entries: [['x', { host: 'x' }], 'nope', null] });
    expect(polluted.size).toBe(0);
    polluted.loadFromJSON(undefined);
    expect(polluted.size).toBe(0);
  });
});
