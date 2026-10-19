import { describe, expect, it } from 'vitest';
import { formatForField } from '@/formatter';
import { compileResume } from '@/resume/compiler/compile';
import { validateResumeFacts } from '@/resume/schema/validate';
import { extractResumeFacts } from '@/resume/parser/resumeStructureExtractor';
import { createSampleResumeFacts, sampleFact } from '@/shared/samples/sampleResume';

describe('GPA, awards and additional facts', () => {
  it('preserves original GPA scale, awards and provenance through validation and compilation', () => {
    const facts = createSampleResumeFacts(); facts.education[0]!.gpa = sampleFact('3.6/4.0');
    facts.basic.awards = sampleFact('全国竞赛二等奖'); facts.basic.additionalInfo = sampleFact('可于六月入职');
    const compiled = compileResume(validateResumeFacts(facts));
    expect(compiled.normalized.education[0]?.gpa).toBe('3.6/4.0');
    expect(compiled.normalized.basic.awards).toBe('全国竞赛二等奖');
    expect(compiled.facts.education[0]?.gpa).toEqual(facts.education[0]?.gpa);
    facts.education[0]!.gpa = sampleFact(3.6);
    expect(compileResume(validateResumeFacts(facts)).normalized.education[0]?.gpa).toBe(3.6);
  });
  it('extracts the actual GPA number for matching numeric controls without changing the fact', () => {
    expect(formatForField('3.6/4.0', { controlKind: 'number', label: 'GPA', constraints: { max: '4', step: '0.01' } })).toEqual({ ok: true, value: 3.6, expectedText: '3.6' });
    expect(formatForField('3.6/4.0', { controlKind: 'text' })).toEqual({ ok: true, value: '3.6/4.0', expectedText: '3.6/4.0' });
  });
  it('refuses scale conversions and out-of-range or invalid-step numeric values', () => {
    expect(formatForField('3.6/4.0', { controlKind: 'number', label: 'GPA', constraints: { max: '5' } })).toEqual({ ok: false, reason: 'GPA_SCALE_MISMATCH' });
    expect(formatForField(120, { controlKind: 'number', constraints: { max: '100' } })).toEqual({ ok: false, reason: 'NUMERIC_OUT_OF_RANGE' });
    expect(formatForField(3.6, { controlKind: 'number', constraints: { step: '1' } })).toEqual({ ok: false, reason: 'NUMERIC_STEP_MISMATCH' });
    expect(formatForField('   ', { controlKind: 'number' }).ok).toBe(false);
  });
  it('parses repeated education sections without losing entries and retains awards separately', () => {
    const parsed = extractResumeFacts('姓名：张三\n教育经历\n示例大学 | 本科\nGPA：3.6/4.0\n教育背景\n示例理工大学 | 硕士\n获奖情况\n全国竞赛二等奖\n补充信息\n可于六月入职');
    expect(parsed.facts.education.map((entry) => entry.id)).toEqual(['resume.education.1', 'resume.education.2']);
    expect(parsed.facts.education[0]?.gpa?.value).toBe('3.6/4.0');
    expect(parsed.facts.education[0]?.major).toBeUndefined();
    expect(parsed.facts.basic.awards?.value).toBe('全国竞赛二等奖');
    expect(parsed.facts.basic.additionalInfo?.value).toBe('可于六月入职');
  });
});
