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
