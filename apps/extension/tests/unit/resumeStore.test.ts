import { describe, expect, it } from 'vitest';

import { compileResume } from '@/resume/compiler/compile';
import { activateResumeVersion, clearCompiledResume, deleteResumeVersion, listResumeVersions, loadCompiledResume, saveCompiledResume } from '@/resume/storage/resumeStore';
import { createSampleResumeFacts } from '@/shared/samples/sampleResume';

describe('resumeStore', () => {
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
    const facts = createSampleResumeFacts(); facts.education[0]!.gpa = { value: '3.6/4.0', source: 'user', verified: true, updatedAt: 1 };
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
