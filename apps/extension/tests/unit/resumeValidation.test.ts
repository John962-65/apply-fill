import { describe, expect, it } from 'vitest';

import { compileResume } from '@/resume/compiler';
import { validateResumeFacts } from '@/resume/schema/validate';
import { createSampleResumeFacts } from '@/shared/samples/sampleResume';

describe('resume import validation', () => {
  it('事实 JSON 与项目导出的编译 JSON 均可完整重新导入', () => {
    const facts = createSampleResumeFacts();
    expect(validateResumeFacts(JSON.parse(JSON.stringify(facts)))).toEqual(facts);
    expect(validateResumeFacts(JSON.parse(JSON.stringify(compileResume(facts))))).toEqual(facts);
  });

  it('不接受错误类型、丢失来源和无效日期', () => {
    expect(() => validateResumeFacts({})).toThrow();
    const facts = createSampleResumeFacts();
    facts.basic.birthDate!.value = '2023-02-29';
    expect(() => validateResumeFacts(facts)).toThrow('日期无效');
    facts.basic.birthDate!.value = '2024-02-29';
    const input = JSON.parse(JSON.stringify(facts));
    input.basic.phone.reviewStatus = 'maybe';
    expect(() => validateResumeFacts(input)).toThrow('basic.phone');
  });

  it('重复经历 ID 会破坏身份绑定，因此在写库前拒绝', () => {
    const facts = createSampleResumeFacts();
    facts.projects![1]!.id = facts.projects![0]!.id;
    expect(() => validateResumeFacts(facts)).toThrow('重复');
  });
});
