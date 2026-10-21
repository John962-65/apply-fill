import { describe, expect, it } from 'vitest';

import { compileResume } from '@/resume/compiler';
import { extractResumeFacts } from '@/resume/parser/resumeStructureExtractor';
import { addReviewEntry, editReviewField, listEditableReviewFields, needsReview, reviewFieldIssue } from '@/resume/review/editor';
import { getFact, setFactReviewStatus } from '@/resume/review/facts';
import { validateResumeDraft } from '@/resume/schema/validate';

describe('resume review editor', () => {
  it('展示缺失的联系方式而不伪造事实或要求确认空白可选字段', () => {
    const facts = extractResumeFacts('姓名：李雷').facts;
    const fields = listEditableReviewFields(facts);
    expect(fields.find((field) => field.path === 'basic.email')).toMatchObject({ missing: true, value: '' });
    expect(fields.filter(needsReview).map((field) => field.path)).toEqual(['basic.name']);
    expect(facts.basic.email).toBeUndefined();
  });

  it('补录字段仍需确认，确认后才进入可填写资料', () => {
    const facts = extractResumeFacts('姓名：李雷').facts;
    const email = listEditableReviewFields(facts).find((field) => field.path === 'basic.email')!;
    const edited = editReviewField(facts, email, 'lilei@example.com');
    expect(getFact(edited, email.path)).toMatchObject({ source: 'user', reviewStatus: 'pending' });
    expect(compileResume(edited).normalized.basic.email).toBeUndefined();
    expect(compileResume(setFactReviewStatus(edited, email.path, 'confirmed')).normalized.basic.email).toBe('lilei@example.com');
    expect(facts.basic.email).toBeUndefined();
  });

  it('能补录整段遗漏经历，保持唯一身份且通过草稿校验', () => {
    let facts = addReviewEntry(extractResumeFacts('姓名：李雷').facts, 'work');
    const company = listEditableReviewFields(facts).find((field) => field.path === 'work[0].company')!;
    expect(reviewFieldIssue(company)).toContain('请补充');
    facts = editReviewField(facts, company, '示例公司');
    const role = listEditableReviewFields(facts).find((field) => field.path === 'work[0].role')!;
    facts = editReviewField(facts, role, '研发工程师');
    facts = addReviewEntry(facts, 'work');
    expect(new Set(facts.work!.map((entry) => entry.id)).size).toBe(2);
    expect(validateResumeDraft(facts).work?.[0]?.role?.value).toBe('研发工程师');
  });

  it('异常日期和邮箱显示具体修改原因，不把拒绝项计入待处理', () => {
    const facts = extractResumeFacts('姓名：李雷\n教育经历\n示例大学 | 本科 | 2020.09 - 2024.06').facts;
    const fields = listEditableReviewFields(facts);
    const start = fields.find((field) => field.path === 'education[0].startDate')!;
    expect(reviewFieldIssue({ ...start, value: '2024-15' })).toContain('日期无法识别');
    expect(reviewFieldIssue({ ...start, value: '2024-09' })).toBeUndefined();
    expect(needsReview({ ...start, value: '', status: 'rejected' })).toBe(false);
    const email = fields.find((field) => field.path === 'basic.email')!;
    expect(reviewFieldIssue({ ...email, value: 'invalid' })).toContain('邮箱格式');
  });

  it('补录只接受当前界面列出的字段路径', () => {
    const facts = extractResumeFacts('姓名：李雷').facts;
    const field = listEditableReviewFields(facts)[0]!;
    expect(() => editReviewField(facts, { ...field, path: 'basic.__proto__' }, 'bad')).toThrow();
  });

  it('清空提取日期保留历史引用，允许保存草稿并稍后补录', () => {
    const facts = extractResumeFacts('姓名：李雷\n工作经历\n示例公司 | 工程师 | 2020.09 - 2024.06').facts;
    const start = listEditableReviewFields(facts).find((field) => field.path === 'work[0].startDate')!;
    const cleared = editReviewField(facts, start, '');
    expect(cleared.work?.[0]?.startDate).toMatchObject({ value: '', originalValue: '2020-09', valueModified: true, evidenceStatus: 'historical' });
    expect(() => validateResumeDraft(cleared)).not.toThrow();
    expect(facts.work?.[0]?.startDate?.value).toBe('2020-09');
  });
});
