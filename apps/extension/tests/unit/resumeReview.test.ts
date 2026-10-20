import { describe, expect, it } from 'vitest';

import { compileResume } from '@/resume/compiler';
import { getFact, setFactReviewStatus, updateFactValue } from '@/resume/review/facts';
import { checkPathFillability } from '@/resume/validation/fillability';
import { createSampleResumeFacts } from '@/shared/samples/sampleResume';

describe('field-level review', () => {
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
