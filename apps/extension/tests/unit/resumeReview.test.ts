import { describe, expect, it } from 'vitest';

import { compileResume } from '@/resume/compiler';
import { confirmAllWithEvidence, getFact, setFactReviewStatus, updateFactValue } from '@/resume/review/facts';
import { extractResumeFacts } from '@/resume/parser/resumeStructureExtractor';
import { validateResumeDraft, validateResumeFacts } from '@/resume/schema/validate';
import { checkPathFillability } from '@/resume/validation/fillability';
import { createSampleResumeFacts } from '@/shared/samples/sampleResume';

describe('field-level review', () => {
  it('编辑提取值保留原始引用和值，但不再将原文当作新值证据', () => {
    const facts = extractResumeFacts('姓名：张三\n邮箱：old@example.com').facts;
    facts.basic.email!.confidence = 0.9;
    const edited = updateFactValue(facts, 'basic.email', 'new@example.com');
    expect(edited.basic.email).toMatchObject({ value: 'new@example.com', originalValue: 'old@example.com', valueModified: true,
      evidenceStatus: 'historical', reviewStatus: 'pending', verified: false,
      evidence: [{ text: '邮箱：old@example.com', status: 'historical' }] });
    expect(edited.basic.email?.confidence).toBeUndefined();
    expect(confirmAllWithEvidence(edited).basic.email?.reviewStatus).toBe('pending');
    const confirmed = setFactReviewStatus(edited, 'basic.email', 'confirmed');
    expect(confirmed.basic.email?.evidenceStatus).toBe('historical');
    expect(compileResume(confirmed).normalized.basic.email).toBe('new@example.com');
    expect(updateFactValue(edited, 'basic.email', 'third@example.com').basic.email?.originalValue).toBe('old@example.com');
    expect(facts.basic.email?.value).toBe('old@example.com');
  });

  it('相同值不会制造修改历史；草稿允许待纠正的日期，正式导入和确认值仍严格校验', () => {
    const facts = extractResumeFacts('姓名：张三\n教育经历\n示例大学 | 本科 | 2020.09 - 2024.06').facts;
    expect(updateFactValue(facts, 'basic.name', '张三').basic.name.valueModified).toBeUndefined();
    const pending = updateFactValue(facts, 'education[0].startDate', '2024-19');
    expect(() => validateResumeDraft(pending)).not.toThrow();
    expect(() => validateResumeFacts(pending)).toThrow('日期无效');
    expect(() => validateResumeDraft(setFactReviewStatus(pending, 'education[0].startDate', 'confirmed'))).toThrow('日期无效');
  });
  it('未确认事实保留在草稿中但不会进入 normalized 或 Planner', () => {
    const facts = createSampleResumeFacts();
    facts.projects![0]!.name.reviewStatus = 'pending';
    facts.projects![0]!.name.verified = false;
    const compiled = compileResume(facts);
    expect(compiled.normalized.projects?.[0]?.name).toBe('');
    const check = checkPathFillability(compiled, 'projects[0].name');
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('FACT_NOT_CONFIRMED');
  });

  it('拒绝字段会阻止填写且不会被确认操作覆盖', () => {
    const facts = setFactReviewStatus(createSampleResumeFacts(), 'basic.email', 'rejected');
    expect(getFact(facts, 'basic.email')?.reviewStatus).toBe('rejected');
    const compiled = compileResume(facts);
    expect(compiled.normalized.basic.email).toBeUndefined();
    expect(checkPathFillability(compiled, 'basic.email', { controlKind: 'email' }).reason).toBe('FACT_REJECTED');
  });

  it('编辑事实值保持确认状态并同步 verified 镜像', () => {
    const facts = updateFactValue(createSampleResumeFacts(), 'basic.intro', '更新后的简介');
    expect(getFact(facts, 'basic.intro')?.value).toBe('更新后的简介');
    expect(getFact(facts, 'basic.intro')?.reviewStatus).toBe('pending');
    expect(getFact(facts, 'basic.intro')?.verified).toBe(false);
  });

  it('日期精度不足时 Planner 拒绝自动填写', () => {
    const facts = createSampleResumeFacts();
    facts.education[0]!.startDate = { ...facts.education[0]!.startDate!, value: '2018' };
    const compiled = compileResume(facts);
    const check = checkPathFillability(compiled, 'education[0].dateRange', { controlKind: 'date' });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('DATE_PRECISION_INSUFFICIENT');
  });

  it('项目派生文本出现来源外数字时判定不可填写', () => {
    const facts = createSampleResumeFacts();
    facts.projects![0]!.description!.value = '负责多机械臂协同规划平台的前端架构与可视化模块开发。';
    const compiled = compileResume(facts);
    expect(checkPathFillability(compiled, 'projections.projects[0].one_liner').ok).toBe(true);
    compiled.projections.projects![0]!.one_liner = '性能提升 400%';
    const check = checkPathFillability(compiled, 'projections.projects[0].one_liner');
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('DERIVED_TEXT_INVALID');
  });
});
