import { describe, expect, it } from 'vitest';

import { UserCorrectionStore } from '@/memory/UserCorrectionStore';

describe('UserCorrectionStore', () => {
  it('追加修正记录并生成标识与时间', () => {
    let counter = 0;
    const store = new UserCorrectionStore(
      () => 1000,
      200,
      () => `id-${counter++}`,
    );
    const record = store.append({ host: 'a.com', label: '紧急联系人', controlKind: 'text', kind: 'REMAP', targetPath: 'basic.name' });
    expect(record.id).toBe('id-0');
    expect(record.createdAt).toBe(1000);
    expect(store.list()).toHaveLength(1);
  });

  it('只存路径不存字段值', () => {
    const store = new UserCorrectionStore();
    const record = store.append({ host: 'a.com', label: '姓名', controlKind: 'text', kind: 'MANUAL_EDIT' });
    expect(record).not.toHaveProperty('value');
    expect(JSON.stringify(store.toJSON().records)).not.toContain('张三');
  });

  it('超出容量时裁剪最早记录', () => {
    const store = new UserCorrectionStore(() => 1, 2, () => 'id');
    store.append({ host: 'a.com', label: '甲', controlKind: 'text', kind: 'REMAP', targetPath: 'basic.name' });
    store.append({ host: 'a.com', label: '乙', controlKind: 'text', kind: 'REMAP', targetPath: 'basic.name' });
    store.append({ host: 'a.com', label: '丙', controlKind: 'text', kind: 'REMAP', targetPath: 'basic.name' });
    expect(store.size).toBe(2);
    expect(store.list()[0]?.label).toBe('乙');
  });

  it('按标识删除记录', () => {
    let counter = 0;
    const store = new UserCorrectionStore(() => 1, 200, () => `id-${counter++}`);
    const first = store.append({ host: 'a.com', label: '甲', controlKind: 'text', kind: 'REMAP' });
    store.append({ host: 'a.com', label: '乙', controlKind: 'text', kind: 'REMAP' });
    expect(store.remove(first.id)).toBe(true);
    expect(store.remove('missing')).toBe(false);
    expect(store.size).toBe(1);
  });

  it('序列化往返一致并过滤非法记录', () => {
    let counter = 0;
    const store = new UserCorrectionStore(() => 7, 200, () => `id-${counter++}`);
    store.append({ host: 'a.com', label: '姓名', controlKind: 'text', kind: 'REMAP', targetPath: 'basic.name' });
    const restored = new UserCorrectionStore();
    restored.loadFromJSON(JSON.parse(JSON.stringify(store.toJSON())));
    expect(restored.list()).toHaveLength(1);
    expect(restored.list()[0]?.targetPath).toBe('basic.name');
    const polluted = new UserCorrectionStore();
    polluted.loadFromJSON({ records: [{ id: 'x', label: 'y', kind: 'NOPE' }, { id: 'x' }, null] });
    expect(polluted.size).toBe(0);
    polluted.loadFromJSON(undefined);
    expect(polluted.size).toBe(0);
    polluted.clear();
    expect(polluted.size).toBe(0);
  });
});
