import { describe, expect, it } from 'vitest';

import { validateResumeExtraction } from '@/resume/extraction/resumeExtractionSchema';
import { ResumeSourceIndex } from '@/resume/extraction/sourceGrounding';

const SOURCE = `[第 1 页]
姓名：张三
教育经历
示例大学 | 本科 | 2018.09 - 2022.06
工作经历
示例大学 | 研究助理 | 2022.07 - 2023.06
负责研究数据整理
项目经历
推荐平台 | 2023.07 - 2023.12
性能提升 30%
负责推荐算法
消息中心 | 2024.01 - 2024.06
性能提升 70%
[第 2 页]
项目经历
可视化平台 | 2024.07 - 至今
降低延迟 80%
`;
const field = (value: string, quote = value, page = 1, lineId?: string) => ({ value, quote, page, ...(lineId ? { lineId } : {}) });
function data(extra: Record<string, unknown> = {}) {
  return { basic: { name: field('张三', '姓名：张三') }, education: [], work: [], projects: [], skills: [], warnings: [], ...extra };
}

describe('page, section and entry grounding', () => {
  it('同页不同项目的成果与日期不能互相借用，正确引用保留定位元数据', () => {
    const result = validateResumeExtraction(data({ projects: [
      { name: field('推荐平台'), description: field('负责推荐算法'), outcomes: field('性能提升 70%'), startDate: field('2024-01', '2024.01 - 2024.06') },
      { name: field('消息中心'), outcomes: field('性能提升 30%'), startDate: field('2024-01', '2024.01 - 2024.06') },
    ] }), SOURCE)!;
    expect(result.facts.projects).toHaveLength(2);
    expect(result.facts.projects?.[0]?.outcomes).toBeUndefined();
    expect(result.facts.projects?.[0]?.startDate).toBeUndefined();
    expect(result.facts.projects?.[1]?.outcomes).toBeUndefined();
    expect(result.facts.projects?.[1]?.startDate?.value).toBe('2024-01');
    const evidence = result.facts.projects?.[0]?.description?.evidence?.[0];
    expect(evidence).toMatchObject({ page: 1, section: '项目经历', sectionKind: 'projects', status: 'current' });
    expect(evidence?.instanceId).toMatch(/^projects:p1-l/);
    expect(SOURCE.slice(evidence!.startOffset, evidence!.endOffset)).toBe('负责推荐算法');
  });

  it('即使模型未返回后一个项目，也不扩大前一个项目的证据范围', () => {
    const result = validateResumeExtraction(data({ projects: [{ name: field('推荐平台'), outcomes: field('性能提升 70%') }] }), SOURCE)!;
    expect(result.facts.projects?.[0]?.outcomes).toBeUndefined();
  });

  it('模型漏掉后一个教育或工作实例时，标题中的学历和职位不会扩大前一实例范围', () => {
    const source = '姓名：张三\n教育经历\nFirst University | Bachelor | 2018 - 2022\nSecond College | Master | 2023 - 2025\n工作经历\nFirst Labs | Engineer | 2022 - 2023\n负责平台开发\nSecond Labs | Engineer | 2024 - 2025\n完成流量优化';
    const result = validateResumeExtraction(data({
      education: [{ school: field('First University'), degree: field('Bachelor'), startDate: field('2023', 'Second College | Master | 2023 - 2025') }],
      work: [{ company: field('First Labs'), description: field('完成流量优化'), startDate: field('2024', 'Second Labs | Engineer | 2024 - 2025') }],
    }), source)!;
    expect(result.facts.education[0]?.startDate).toBeUndefined();
    expect(result.facts.work?.[0]?.description).toBeUndefined();
    expect(result.facts.work?.[0]?.startDate).toBeUndefined();
  });

  it('跨页引用必须属于同一实例，不能拿另一页的项目成果', () => {
    const result = validateResumeExtraction(data({ projects: [
      { name: field('推荐平台'), outcomes: field('降低延迟 80%', '降低延迟 80%', 2) },
      { name: field('可视化平台', '可视化平台', 2), outcomes: field('降低延迟 80%', '降低延迟 80%', 2) },
    ] }), SOURCE)!;
    expect(result.facts.projects?.[0]?.outcomes).toBeUndefined();
    expect(result.facts.projects?.[1]?.outcomes?.evidence?.[0]?.page).toBe(2);
  });

  it('声称的 PDF 页码错误时不以全文命中作为补救', () => {
    const result = validateResumeExtraction(data({ basic: { name: field('张三', '姓名：张三', 2) } }), SOURCE)!;
    expect(result.facts.basic.name.value).toBe('');
    expect(result.warnings).toHaveLength(1);
  });

  it('教育与工作中出现同名大学，证据仍按所属章节和实例隔离', () => {
    const result = validateResumeExtraction(data({
      education: [{ school: field('示例大学', '示例大学 | 本科 | 2018.09 - 2022.06'), degree: field('本科'), startDate: field('2022-07', '2022.07 - 2023.06') }],
      work: [{ company: field('示例大学', '示例大学 | 研究助理 | 2022.07 - 2023.06'), role: field('研究助理'), startDate: field('2018-09', '2018.09 - 2022.06') }],
    }), SOURCE)!;
    expect(result.facts.education[0]?.startDate).toBeUndefined();
    expect(result.facts.work?.[0]?.startDate).toBeUndefined();
    expect(result.facts.work?.[0]?.role?.evidence?.[0]?.sectionKind).toBe('work');
    expect(result.facts.education[0]?.degree?.evidence?.[0]?.sectionKind).toBe('education');
  });

  it('不能用跨越两个项目的长引用绕过实例范围', () => {
    const quote = '性能提升 30%\n负责推荐算法\n消息中心 | 2024.01 - 2024.06\n性能提升 70%';
    const result = validateResumeExtraction(data({ projects: [{ name: field('推荐平台'), outcomes: field('性能提升 70%', quote) }] }), SOURCE)!;
    expect(result.facts.projects?.[0]?.outcomes).toBeUndefined();
  });

  it('同名经历无法唯一定位时拒绝，提供正确行 ID 后独立绑定', () => {
    const source = '姓名：张三\n项目经历\n推荐平台\n性能提升 30%\n推荐平台\n性能提升 70%';
    const ambiguous = validateResumeExtraction(data({ projects: [{ name: field('推荐平台'), outcomes: field('性能提升 70%') }] }), source)!;
    expect(ambiguous.facts.projects).toBeUndefined();
    const lines = new ResumeSourceIndex(source).lines.filter((line) => line.text === '推荐平台');
    const result = validateResumeExtraction(data({ projects: [
      { name: field('推荐平台', '推荐平台', 1, lines[0]!.id), outcomes: field('性能提升 30%') },
      { name: field('推荐平台', '推荐平台', 1, lines[1]!.id), outcomes: field('性能提升 70%') },
    ] }), source)!;
    expect(result.facts.projects?.map((entry) => entry.outcomes?.value)).toEqual(['性能提升 30%', '性能提升 70%']);
    expect(new Set(result.facts.projects?.map((entry) => entry.name.evidence?.[0]?.instanceId)).size).toBe(2);
  });

  it('错误行 ID 不能退回到其他位置，模型重复认领标题也不能制造两个实例', () => {
    const result = validateResumeExtraction(data({ projects: [{ name: field('推荐平台', '推荐平台', 1, 'p2-l2') }] }), SOURCE)!;
    expect(result.facts.projects).toBeUndefined();
    const duplicated = validateResumeExtraction(data({ projects: [{ name: field('推荐平台') }, { name: field('推荐平台') }] }), SOURCE)!;
    expect(duplicated.facts.projects).toBeUndefined();
  });

  it('单个经历可跨页延续，但每项引用仍需正确页码', () => {
    const source = '[第 1 页]\n姓名：张三\n项目经历\n推荐平台 | 2023.01 - 2024.01\n负责推荐算法\n[第 2 页]\n性能提升 30%';
    const result = validateResumeExtraction(data({ projects: [{ name: field('推荐平台'), outcomes: field('性能提升 30%', '性能提升 30%', 2) }] }), source)!;
    expect(result.facts.projects?.[0]?.outcomes?.value).toBe('性能提升 30%');
    expect(result.facts.projects?.[0]?.outcomes?.evidence?.[0]?.instanceId).toBe(result.facts.projects?.[0]?.name.evidence?.[0]?.instanceId);
  });
});
