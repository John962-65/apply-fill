import { describe, expect, it } from 'vitest';

import { compileResume } from '@/resume/compiler/compile';
import { activateResumeVersion, clearCompiledResume, deleteResumeVersion, listResumeVersions, loadCompiledResume, saveCompiledResume, updateActiveCompiledResume } from '@/resume/storage/resumeStore';
import { updateFactValue, setFactReviewStatus } from '@/resume/review/facts';
import { validateResumeDraft } from '@/resume/schema/validate';
import { createSampleResumeFacts } from '@/shared/samples/sampleResume';

describe('resumeStore', () => {
  async function rawStore<T>(operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const opening = indexedDB.open('applyfill', 1);
      opening.onsuccess = () => {
        const db = opening.result; const tx = db.transaction('resumes', 'readwrite');
        const request = operation(tx.objectStore('resumes'));
        tx.oncomplete = () => { db.close(); resolve(request.result); };
        tx.onerror = () => reject(tx.error);
      };
      opening.onerror = () => reject(opening.error);
    });
  }
  it('初始状态为空', async () => {
    expect(await loadCompiledResume()).toBeNull();
  });

  it('retains imports as named versions, switches atomically and protects the active version', async () => {
    await clearCompiledResume();
    const first = createSampleResumeFacts(); first.basic.name.value = '甲版本';
    await saveCompiledResume(compileResume(first), '前端岗位');
    const second = createSampleResumeFacts(); second.basic.name.value = '乙版本';
    await saveCompiledResume(compileResume(second), '后端岗位');
    const versions = await listResumeVersions();
    expect(versions.map((version) => [version.label, version.active])).toEqual([['后端岗位', true], ['前端岗位', false]]);
    expect(await activateResumeVersion(versions[1]!.id)).toBe(true);
    expect((await loadCompiledResume())?.normalized.basic.name).toBe('甲版本');
    expect(await deleteResumeVersion(versions[1]!.id)).toBe(false);
    expect(await deleteResumeVersion(versions[0]!.id)).toBe(true);
    expect(await listResumeVersions()).toHaveLength(1);
    expect(await activateResumeVersion('missing')).toBe(false);
    await clearCompiledResume(); expect(await listResumeVersions()).toEqual([]);
  });

  it('bounds history while retaining the newest active import', async () => {
    await clearCompiledResume();
    for (let index = 0; index < 22; index++) await saveCompiledResume(compileResume(createSampleResumeFacts()), `版本 ${index}`);
    const versions = await listResumeVersions();
    expect(versions).toHaveLength(20); expect(versions[0]).toMatchObject({ label: '版本 21', active: true });
    expect(versions.some((version) => version.label === '版本 0')).toBe(false);
    await clearCompiledResume();
  });

  it('recompiles older stored exports from their original facts when the compiler changes', async () => {
    await clearCompiledResume();
    const facts = createSampleResumeFacts(); facts.education[0]!.gpa = { value: '3.6/4.0', source: 'user', verified: true, reviewStatus: 'confirmed', updatedAt: 1 };
    const old = compileResume(facts, 42); delete old.compilerVersion; delete old.normalized.education[0]!.gpa;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('applyfill', 1);
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction('resumes', 'readwrite'); tx.objectStore('resumes').put(old, 'current');
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
    expect((await loadCompiledResume())?.normalized.education[0]?.gpa).toBe('3.6/4.0');
    await clearCompiledResume();
  });

  it('legacy verified facts migrate to pending and never auto-fill without review', async () => {
    await clearCompiledResume();
    const facts = createSampleResumeFacts() as unknown as Record<string, unknown>;
    facts.schemaVersion = 1;
    const education = facts.education as Array<Record<string, unknown>>;
    education[0]!.gpa = { value: '3.6/4.0', source: 'user', verified: true, updatedAt: 1 };
    delete (education[0]!.gpa as Record<string, unknown>).reviewStatus;
    const old = { ...compileResume(createSampleResumeFacts(), 42), facts, schemaVersion: 1, compilerVersion: 1 };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('applyfill', 1);
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction('resumes', 'readwrite'); tx.objectStore('resumes').put(old, 'current');
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
    const loaded = await loadCompiledResume();
    expect(loaded?.normalized.education[0]?.gpa).toBeUndefined();
    const gpa = loaded?.facts.education[0]?.gpa;
    expect(gpa?.reviewStatus).toBe('pending');
    expect(gpa?.verified).toBe(false);
    await clearCompiledResume();
  });

  it('旧版空姓名、缺失学历和空日期按草稿恢复，读取不会覆盖原始记录', async () => {
    await clearCompiledResume();
    const fact = (value: string) => ({ value, source: 'resume-import', verified: false, updatedAt: 1 });
    const rawFacts = { schemaVersion: 1, updatedAt: 1, basic: { name: fact('') },
      education: [{ school: fact('示例大学'), startDate: fact('') }], preferences: {}, unrecognizedNotes: '保留的原始信息' };
    const old = { compilerVersion: 1, schemaVersion: 1, compiledAt: 42, facts: rawFacts, normalized: { basic: { name: '' } } };
    await rawStore((store) => store.put(old, 'current'));
    const loaded = await loadCompiledResume();
    expect(loaded?.facts.basic.name.reviewStatus).toBe('pending');
    expect(loaded?.facts.education[0]?.degree.value).toBe('');
    expect(loaded?.facts.education[0]?.startDate?.value).toBe('');
    expect(loaded?.facts.migration?.originalFacts).toEqual(rawFacts);
    expect(await rawStore((store) => store.get('current'))).toEqual(old);
    expect(loaded?.normalized.basic.name).toBe('');
    let edited = updateFactValue(loaded!.facts, 'basic.name', '恢复后的姓名');
    edited = setFactReviewStatus(edited, 'basic.name', 'confirmed');
    await updateActiveCompiledResume(compileResume(validateResumeDraft(edited)));
    const saved = await loadCompiledResume();
    expect(saved?.normalized.basic.name).toBe('恢复后的姓名');
    expect(saved?.facts.migration?.originalFacts).toEqual(rawFacts);
    await clearCompiledResume();
  });

  it('旧版缺少姓名、经历 ID 或含损坏字段时可恢复，所有原始字段留在快照', async () => {
    await clearCompiledResume();
    const rawFacts = { schemaVersion: 1, basic: { phone: { value: 123, verified: true } }, education: [{}], projects: [{ id: 'same' }, { id: 'same' }] };
    await rawStore((store) => store.put({ facts: rawFacts, compilerVersion: 1, schemaVersion: 1 }, 'current'));
    const loaded = await loadCompiledResume();
    expect(loaded?.facts.basic.name.value).toBe('');
    expect(loaded?.facts.basic.phone).toBeUndefined();
    expect(loaded?.facts.education[0]?.school.value).toBe('');
    expect(new Set(loaded?.facts.projects?.map((entry) => entry.id)).size).toBe(2);
    expect(loaded?.facts.migration?.originalFacts).toEqual(rawFacts);
    await saveCompiledResume(compileResume(createSampleResumeFacts()), '新导入');
    const versions = await listResumeVersions();
    expect(versions).toHaveLength(2);
    await activateResumeVersion(versions[1]!.id);
    expect((await loadCompiledResume())?.facts.migration?.originalFacts).toEqual(rawFacts);
    await clearCompiledResume();
  });

  it('保存后可重复读取并支持清除', async () => {
    const compiled = compileResume(createSampleResumeFacts(), 42);

    await saveCompiledResume(compiled);
    const first = await loadCompiledResume();
    const second = await loadCompiledResume();

    expect(first?.compiledAt).toBe(42);
    expect(first?.normalized.basic.name).toBe('张三');
    expect(second?.compiledAt).toBe(42);

    await clearCompiledResume();
    expect(await loadCompiledResume()).toBeNull();
  });
});
