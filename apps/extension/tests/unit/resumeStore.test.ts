import { describe, expect, it } from 'vitest';

import { compileResume } from '@/resume/compiler/compile';
import { clearCompiledResume, loadCompiledResume, saveCompiledResume } from '@/resume/storage/resumeStore';
import { createSampleResumeFacts } from '@/shared/samples/sampleResume';

describe('resumeStore', () => {
  it('初始状态为空', async () => {
    expect(await loadCompiledResume()).toBeNull();
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
