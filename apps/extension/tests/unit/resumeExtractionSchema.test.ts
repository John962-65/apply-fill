import { describe, expect, it } from 'vitest';

import { validateResumeExtraction } from '@/resume/extraction/resumeExtractionSchema';

const SOURCE = '张三\n项目A\n性能提升 300%\n负责前端开发';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    basic: {
      name: { value: '张三', quote: '张三', page: 1 },
      phone: { value: '', quote: '', page: 1 },
      email: { value: '', quote: '', page: 1 },
      gender: { value: '', quote: '', page: 1 },
      birthDate: { value: '', quote: '', page: 1 },
      intro: { value: '', quote: '', page: 1 },
      location: { value: '', quote: '', page: 1 },
      city: { value: '', quote: '', page: 1 },
      postalCode: { value: '', quote: '', page: 1 },
      idType: { value: '', quote: '', page: 1 },
      idExplanation: { value: '', quote: '', page: 1 },
      awards: { value: '', quote: '', page: 1 },
      additionalInfo: { value: '', quote: '', page: 1 },
    },
    education: [],
    work: [],
    projects: [{
      name: { value: '项目A', quote: '项目A', page: 1 },
      role: { value: '', quote: '', page: 1 },
      description: { value: '性能提升 300%；负责前端开发', quote: '性能提升 300%\n负责前端开发', page: 1 },
      responsibilities: { value: '', quote: '', page: 1 },
      outcomes: { value: '', quote: '', page: 1 },
      keywords: { value: '', quote: '', page: 1 },
      startDate: { value: '', quote: '', page: 1 },
      endDate: { value: '', quote: '', page: 1 },
    }],
    skills: [],
    preferences: {
      expectedSalary: { value: 0, quote: '', page: 1 },
      freshGraduate: { value: false, quote: '', page: 1 },
      subscribeNotifications: { value: false, quote: '', page: 1 },
    },
    warnings: [],
    ...overrides,
  };
}

describe('LLM extraction grounding', () => {
  it('保留有原文引用的字段并全部标记待确认', () => {
    const result = validateResumeExtraction(payload(), SOURCE, 1000);
    expect(result?.facts.basic.name.value).toBe('张三');
    expect(result?.facts.basic.name.reviewStatus).toBe('pending');
    expect(result?.facts.projects?.[0]?.description?.value).toContain('性能提升 300%');
    expect(result?.facts.projects?.[0]?.description?.evidence?.[0]?.text).toContain('性能提升 300%');
  });

  it('丢弃原文中不存在的引用和编造数字', () => {
    const result = validateResumeExtraction(payload({
      projects: [{
        name: { value: '项目A', quote: '项目A', page: 1 },
        role: { value: '', quote: '', page: 1 },
        description: { value: '性能提升 500%', quote: '性能提升 500%', page: 1 },
        responsibilities: { value: '', quote: '', page: 1 },
        outcomes: { value: '', quote: '', page: 1 },
        keywords: { value: '', quote: '', page: 1 },
        startDate: { value: '', quote: '', page: 1 },
        endDate: { value: '', quote: '', page: 1 },
      }],
    }), SOURCE, 1000);
    expect(result?.facts.projects?.[0]?.description).toBeUndefined();
    expect(result?.warnings.some((warning) => warning.includes('未在简历中找到'))).toBe(true);
  });
});
