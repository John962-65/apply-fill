import { describe, expect, it, vi } from 'vitest';

import { ContextStore } from '@/background/ContextStore';
import { CORRECTIONS_KEY, JOB_CONTEXTS_KEY } from '@/shared/contracts/context';
import type { DocumentScope, UserCorrectionRecord } from '@/shared/contracts/context';

function storage(initial: Record<string, unknown> = {}) {
  const values = structuredClone(initial);
  return { values, get: vi.fn(async (key: string) => structuredClone({ [key]: values[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(values, structuredClone(items)); }),
    remove: vi.fn(async (key: string) => { delete values[key]; }) };
}
function fixture() {
  const local = storage(); const session = storage(); let id = 0; let now = 1000;
  return { local, session, store: new ContextStore(local, session, () => now, () => `id-${++id}`), setNow: (value: number) => { now = value; } };
}
function record(id: string): UserCorrectionRecord {
  return { id, host: 'forged.example', label: '姓名', controlKind: 'text', kind: 'REMAP', targetPath: 'basic.name', createdAt: 1 };
}
const scope: DocumentScope = { tabId: 1, frameId: 0, documentId: 'document-a', url: 'https://jobs.example/job/a' };
const job = { title: '工程师', company: '公司甲', source: 'jsonld' as const, confidence: 'high' as const };

describe('background context persistence', () => {
  it('saved job versions survive context expiry and restart, and are only applied explicitly', async () => {
    const { store, local, session, setNow } = fixture();
    const context = await store.saveContext(job, scope); const version = await store.saveJobVersion(context.id!);
    setNow(context.expiresAt + 1);
    expect(await store.listContexts()).toEqual([]);
    const restarted = new ContextStore(local, session, () => context.expiresAt + 1);
    expect(await restarted.listJobVersions()).toHaveLength(1);
    const destination = { ...scope, documentId: 'new-document', url: 'https://jobs.example/apply' };
    expect(await restarted.getContext(destination)).toBeUndefined();
    expect((await restarted.assignJobVersion(version.id, destination)).company).toBe('公司甲');
    await restarted.deleteJobVersion(version.id); expect(await restarted.listJobVersions()).toEqual([]);
  });
  it('only a manually assigned current main document passes its job context to child frames', async () => {
    const { store } = fixture(); const original = await store.saveContext(job, scope);
    const child = { ...scope, frameId: 3, documentId: 'child', url: 'https://forms.example/embedded' };
    expect(await store.getContext(child, scope)).toBeUndefined();
    await store.assignContext(original.id!, scope);
    expect((await store.getContext(child, scope))?.company).toBe('公司甲');
    expect(await store.getContext({ ...child, tabId: 2 }, scope)).toBeUndefined();
    expect(await store.getContext(child, { ...scope, documentId: 'reloaded' })).toBeUndefined();
    expect(await store.getContext(child, { ...scope, url: `${scope.url}?other-job` })).toBeUndefined();
  });
  it('并发新增只合并增量并以浏览器主机和后台时间记录', async () => {
    const { store } = fixture(); const { epoch } = await store.loadCorrections();
    await Promise.all(Array.from({ length: 40 }, (_, index) => store.appendCorrection(epoch, record(String(index)), 'actual.example')));
    const snapshot = await store.loadCorrections();
    expect(snapshot.records).toHaveLength(40);
    expect(snapshot.records.every((item) => item.host === 'actual.example' && item.createdAt === 1000)).toBe(true);
    await store.appendCorrection(epoch, record('1'), 'actual.example');
    expect((await store.loadCorrections()).records).toHaveLength(40);
  });

  it('忽略删除后迟到的重试，Worker 重建后仍保留删除标记', async () => {
    const { store, local, session } = fixture(); const { epoch } = await store.loadCorrections();
    await store.appendCorrection(epoch, record('deleted'), 'example'); await store.removeCorrection('deleted');
    const restarted = new ContextStore(local, session);
    await restarted.appendCorrection(epoch, record('deleted'), 'example');
    expect((await restarted.loadCorrections()).records).toEqual([]);
  });

  it('清空轮换世代，旧客户端的迟到新增不恢复记录，新事件可正常保存', async () => {
    const { store } = fixture(); const { epoch } = await store.loadCorrections();
    await store.appendCorrection(epoch, record('old'), 'example'); await store.clearCorrections();
    expect(await store.appendCorrection(epoch, record('late'), 'example')).toMatchObject({ ok: true, stale: true });
    const fresh = await store.loadCorrections(); expect(fresh.epoch).not.toBe(epoch); expect(fresh.records).toEqual([]);
    await store.appendCorrection(fresh.epoch, record('fresh'), 'example');
    expect((await store.loadCorrections()).records.map((item) => item.id)).toEqual(['fresh']);
  });

  it('读取等待期间失效的文档不能提交历史或 JD', async () => {
    const { store, local, session } = fixture(); const { epoch } = await store.loadCorrections();
    let active = true;
    const assertCurrent = () => { if (!active) throw new Error('STALE_DOCUMENT'); };
    local.get.mockImplementationOnce(async () => { active = false; return {}; });
    await expect(store.appendCorrection(epoch, record('late'), 'example', assertCurrent)).rejects.toThrow('STALE_DOCUMENT');
    expect((await store.loadCorrections()).records).toEqual([]);
    active = true;
    session.get.mockImplementationOnce(async () => { active = false; return {}; });
    await expect(store.saveContext(job, scope, assertCurrent)).rejects.toThrow('STALE_DOCUMENT');
    expect(await store.listContexts()).toEqual([]);
  });

  it('历史限制为 200 条，淘汰记录的旧请求不能重新插入', async () => {
    const { store, local } = fixture(); const { epoch } = await store.loadCorrections();
    await Promise.all(Array.from({ length: 205 }, (_, index) => store.appendCorrection(epoch, record(String(index)), 'example')));
    await store.appendCorrection(epoch, record('0'), 'example');
    expect((await store.loadCorrections()).records).toHaveLength(200);
    expect((await store.loadCorrections()).records[0]?.id).toBe('5');
    expect(JSON.stringify(local.values[CORRECTIONS_KEY])).not.toContain('forged.example');
  });

  it('迁移先提交再删除旧记录，持久化失败时保留旧数据', async () => {
    const local = storage({ 'applyfill.userCorrections.v1': { records: [record('legacy'), null, { value: '秘密' }] } });
    const store = new ContextStore(local, storage());
    local.set.mockRejectedValueOnce(new Error('QUOTA'));
    await expect(store.loadCorrections()).rejects.toThrow('QUOTA');
    expect(local.remove).not.toHaveBeenCalled();
    expect((await store.loadCorrections()).records.map((item) => item.id)).toEqual(['legacy']);
    expect(local.values['applyfill.userCorrections.v1']).toBeUndefined();
  });

  it('同主机的不同职位、Tab、Frame 和文档各自保存，URL 哈希也参与作用域', async () => {
    const { store } = fixture();
    const scopes = [scope, { ...scope, url: 'https://jobs.example/job/b' }, { ...scope, tabId: 2 },
      { ...scope, frameId: 3 }, { ...scope, documentId: 'new-document' }, { ...scope, url: `${scope.url}#step2` }];
    await Promise.all(scopes.map((item, index) => store.saveContext({ ...job, company: `公司${index}` }, item)));
    for (const [index, item] of scopes.entries()) expect((await store.getContext(item))?.company).toBe(`公司${index}`);
    expect(await store.getContext({ ...scope, url: 'https://jobs.example/job/c' })).toBeUndefined();
  });

  it('显式选择岗位才跨页面使用，保持原始到期时间，过期后拒绝选择', async () => {
    const { store, setNow } = fixture(); const first = await store.saveContext(job, scope);
    const destination = { ...scope, url: 'https://apply.example/form' };
    expect(await store.getContext(destination)).toBeUndefined();
    const selected = await store.assignContext(first.id!, destination);
    expect(selected.company).toBe('公司甲'); expect(selected.expiresAt).toBe(first.expiresAt);
    await store.saveContext({ ...job, company: '申请页通用标题' }, destination);
    expect((await store.getContext(destination))?.company).toBe('公司甲');
    expect((await store.getContext(scope))?.company).toBe('公司甲');
    setNow(first.expiresAt);
    expect(await store.getContext(destination)).toBeUndefined();
    await expect(store.assignContext(first.id!, destination)).rejects.toThrow('JOB_CONTEXT_EXPIRED');
  });

  it('旧的按主机缓存保留供手动选择，不自动应用到新页面', async () => {
    const { session, local } = fixture();
    await session.set({ 'applyfill.jdContext.v1': { entries: [['jobs.example', { ...job, host: 'jobs.example', url: scope.url, capturedAt: 1, expiresAt: 3000 }], null] } });
    const store = new ContextStore(local, session, () => 1000, () => 'legacy-id');
    expect(await store.getContext(scope)).toBeUndefined();
    expect(await store.listContexts()).toMatchObject([{ id: 'legacy-id', company: '公司甲' }]);
    expect(session.values['applyfill.jdContext.v1']).toBeUndefined(); expect(session.values[JOB_CONTEXTS_KEY]).toBeDefined();
  });

  it('仅保留 50 个最近岗位并截断超长字段，不保存额外属性', async () => {
    const { store } = fixture();
    await Promise.all(Array.from({ length: 55 }, (_, index) => store.saveContext({ ...job, title: '长'.repeat(1000), secret: '不应保存' }, { ...scope, tabId: index })));
    const entries = await store.listContexts(); expect(entries).toHaveLength(50); expect(entries[0]?.title).toHaveLength(120);
    expect(JSON.stringify(entries)).not.toContain('不应保存');
  });
});
