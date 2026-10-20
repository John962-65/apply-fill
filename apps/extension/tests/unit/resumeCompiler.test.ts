import { describe, expect, it } from 'vitest';

import { compileResume } from '@/resume/compiler/compile';
import { parseDateAtom } from '@/resume/compiler/normalize';
import { buildProjections } from '@/resume/compiler/project';
import { createSampleResumeFacts } from '@/shared/samples/sampleResume';
import type { NormalizedResume } from '@/shared/contracts/resume';

describe('parseDateAtom', () => {
  it('解析年月精度', () => {
    expect(parseDateAtom('2018-09')).toEqual({ year: 2018, month: 9, precision: 'month' });
    expect(parseDateAtom('2022/6')).toEqual({ year: 2022, month: 6, precision: 'month' });
  });

  it('解析纯年份与完整日期', () => {
    expect(parseDateAtom('2022')).toEqual({ year: 2022, precision: 'year' });
    expect(parseDateAtom('2000-05-03')).toEqual({ year: 2000, month: 5, day: 3, precision: 'day' });
  });

  it('识别至今类标记', () => {
    expect(parseDateAtom('至今')).toEqual({ present: true });
    expect(parseDateAtom('Present')).toEqual({ present: true });
  });

  it('无法解析时返回 undefined', () => {
    expect(parseDateAtom('')).toBeUndefined();
    expect(parseDateAtom('去年')).toBeUndefined();
  });

  it('拒绝不存在的日期与尾随内容，并保留中文日期精度', () => {
    for (const invalid of ['2024-13', '2024-00', '2023-02-29', '2024-02-30', '2020-01-00', '2020junk']) {
      expect(parseDateAtom(invalid)).toBeUndefined();
    }
    expect(parseDateAtom('2024年2月29日')).toEqual({ year: 2024, month: 2, day: 29, precision: 'day' });
    expect(parseDateAtom('2026年')).toEqual({ year: 2026, precision: 'year' });
  });
});

describe('compileResume', () => {
  it('归一化基础信息与偏好', () => {
    const compiled = compileResume(createSampleResumeFacts(), 42);
    expect(compiled.compiledAt).toBe(42);
    expect(compiled.normalized.basic.name).toBe('张三');
    expect(compiled.normalized.basic.phone).toBe('13800001111');
    expect(compiled.normalized.basic.birthDate).toEqual({ year: 2000, month: 5, precision: 'month' });
    expect(compiled.normalized.preferences.expectedSalary).toBe(15);
    expect(compiled.normalized.preferences.freshGraduate).toBe(false);
    expect(compiled.normalized.preferences.subscribeNotifications).toBe(true);
  });

  it('归一化教育经历与日期、至今标记', () => {
    const compiled = compileResume(createSampleResumeFacts());
    expect(compiled.normalized.education).toHaveLength(3);
    const first = compiled.normalized.education[0];
    expect(first?.school).toBe('示例大学');
    expect(first?.degree).toBe('本科');
    expect(first?.startDate).toEqual({ year: 2018, month: 9, precision: 'month' });
    expect(first?.endDate).toEqual({ year: 2022, month: 6, precision: 'month' });
    const second = compiled.normalized.education[1];
    expect(second?.endDate).toEqual({ present: true });
  });

  it('归一化项目经历', () => {
    const compiled = compileResume(createSampleResumeFacts());
    expect(compiled.normalized.projects).toHaveLength(3);
    const first = compiled.normalized.projects[0];
    expect(first?.id).toBe('resume.project.1');
    expect(first?.name).toBe('多机械臂协同规划');
    expect(first?.role).toBe('前端负责人');
    expect(first?.startDate).toEqual({ year: 2024, month: 3, precision: 'month' });
    expect(compiled.normalized.projects[2]?.name).toBe('智能表单填写引擎');
  });

  it('缺少 projects 字段时归一化为空数组', () => {
    const facts = createSampleResumeFacts();
    delete facts.projects;
    const compiled = compileResume(facts);
    expect(compiled.normalized.projects).toEqual([]);
  });

  it('项目切面从事实派生且保留来源，不编造缺失成果', () => {
    const facts = createSampleResumeFacts();
    facts.projects![0]!.description!.value = '真实项目描述。'.repeat(50);
    const before = JSON.stringify(facts);
    const compiled = compileResume(facts);
    const projection = compiled.projections.projects?.[0];
    expect(projection?.resumeEntryId).toBe(facts.projects?.[0]?.id);
    expect(projection?.title).toBe(facts.projects?.[0]?.name.value);
    expect(projection?.one_liner).toContain('真实项目描述');
    expect(projection?.one_liner.length).toBeLessThanOrEqual(50);
    expect(projection?.summary_150).toContain('真实项目描述');
    expect(projection?.full_description).toContain('项目背景：真实项目描述');
    expect(projection?.full_description).toContain('职责：前端负责人');
    expect(projection?.outcomes).toBe('');
    expect(projection?.sourceFactPaths).toContain('projects[0].description');
    expect(JSON.stringify(facts)).toBe(before);
  });

  it('buildProjections 生成截断的短简介', () => {
    const normalized: NormalizedResume = {
      basic: { name: '张三', intro: '甲'.repeat(80) },
      education: [],
      work: [],
      projects: [],
      skills: [],
      preferences: {},
    };
    const projections = buildProjections(normalized);
    expect(projections.introShort?.length).toBe(50);
  });

  it('buildProjections 对短简介不截断', () => {
    const normalized: NormalizedResume = {
      basic: { name: '张三', intro: '热爱前端' },
      education: [],
      work: [],
      projects: [],
      skills: [],
      preferences: {},
    };
    expect(buildProjections(normalized).introShort).toBe('热爱前端');
  });
});
