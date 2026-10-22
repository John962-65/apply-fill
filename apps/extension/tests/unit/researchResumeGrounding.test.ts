import { describe, expect, it } from 'vitest';
import { validateResumeExtraction } from '@/resume/extraction/resumeExtractionSchema';
import { ResumeSourceIndex } from '@/resume/extraction/sourceGrounding';
import { formatExtractionWarning } from '@/resume/review/editor';
import { RESEARCH_RESUME_LINES, researchResumePayload } from '../fixtures/researchResume';

const SOURCE = '[第 1 页]\n' + RESEARCH_RESUME_LINES.join('\n');
function payload() { return researchResumePayload(new ResumeSourceIndex(SOURCE).promptLines()); }

describe('research resume source ownership', () => {
  it('省略号分栏、重复学校、科研/横向/开源前缀和括号链接均可定位', () => {
    const result = validateResumeExtraction(payload(), SOURCE)!;
    expect(result.warnings).toEqual([]);
    expect(result.facts.education.map((entry) => [entry.school.value, entry.degree.value, entry.startDate?.value, entry.endDate?.value]))
      .toEqual([['示例交通大学', '工学硕士', '2024-09', '2027-06'], ['示例交通大学', '工学学士', '2020-09', '2024-06']]);
    expect(result.facts.projects).toHaveLength(7);
    expect(result.facts.projects?.every((entry) => entry.description && !entry.startDate && !entry.endDate)).toBe(true);
    expect(new Set(result.facts.projects?.map((entry) => entry.name.evidence?.[0]?.instanceId)).size).toBe(7);
    expect(result.facts.work).toBeUndefined();
    expect(result.facts.basic.city).toBeUndefined();
  });

  it('同名学校使用行 ID 分别绑定，缺少唯一引用时继续拒绝', () => {
    const data = payload();
    data.education.forEach((entry) => { entry.school.quote = '示例交通大学'; });
    expect(validateResumeExtraction(data, SOURCE)?.facts.education).toHaveLength(2);
    data.education.forEach((entry) => { entry.school.lineId = ''; });
    expect(validateResumeExtraction(data, SOURCE)?.facts.education).toHaveLength(0);
  });

  it('客户名称后的单个年份不能推断为项目起止日期', () => {
    const data = payload();
    const projects = data.projects.map((entry, index) => index === 3 ? {
      ...entry, startDate: { ...entry.name, value: '2025' }, endDate: { ...entry.name, value: '2025' },
    } : entry);
    const result = validateResumeExtraction({ ...data, projects }, SOURCE)!;
    expect(result.facts.projects?.[3]?.name.value).toBe('设备失效分析');
    expect(result.facts.projects?.[3]?.startDate).toBeUndefined();
    expect(result.facts.projects?.[3]?.endDate).toBeUndefined();
  });

  it('同一实例内跨行指标和跨行描述完整保留，不能用首行引用支持后文', () => {
    const data = payload();
    const result = validateResumeExtraction(data, SOURCE)!;
    expect(result.facts.projects?.[0]?.outcomes?.value).toContain('减少 90%碰撞验证');
    expect(result.facts.projects?.[0]?.outcomes?.evidence?.[0]?.text).toContain('\n突场景');
    expect(result.facts.projects?.[5]?.description?.value).toContain('独立复核');
    data.projects[0]!.outcomes!.quote = '主要工作：开发规划方法，高冲';
    const rejected = validateResumeExtraction(data, SOURCE)!;
    expect(rejected.facts.projects?.[0]?.outcomes).toBeUndefined();
    expect(rejected.warnings.map(formatExtractionWarning)).toContain('项目经历 1 · 项目成果 的引用未完整支持字段内容，已丢弃；跨行内容需要引用包含完整内容的相邻原文');
  });

  it('漏掉下一科研项目时，前一项目也不能引用其描述；校园奖项不属于末个项目', () => {
    const data = payload();
    data.projects[0]!.description = data.projects[1]!.description;
    data.projects.splice(1, 1);
    data.projects[data.projects.length - 1]!.description = { ...data.basic.awards };
    const result = validateResumeExtraction(data, SOURCE)!;
    expect(result.facts.projects?.[0]?.description).toBeUndefined();
    expect(result.facts.projects?.[5]?.description).toBeUndefined();
    expect(result.facts.basic.awards?.value).toContain('学业奖学金一等奖');
  });

  it('补充信息必须引用两行，警告显示奖项、出生日期、补充信息等具体字段', () => {
    const data = payload();
    expect(validateResumeExtraction(data, SOURCE)?.facts.basic.additionalInfo?.value).toContain('政治面貌');
    data.basic.additionalInfo.quote = '籍贯：示例省示例市';
    const result = validateResumeExtraction(data, SOURCE)!;
    expect(result.facts.basic.additionalInfo).toBeUndefined();
    expect(result.warnings.map(formatExtractionWarning).join('\n')).toContain('个人信息 · 补充信息');
    expect(formatExtractionWarning('basic.awards 丢弃')).toContain('个人信息 · 奖项');
    expect(formatExtractionWarning('basic.birthDate 丢弃')).toContain('出生日期');
  });

  it('标题中的一部分不能成为另一个经历名称，正文标签不能伪装成项目标题', () => {
    const data = payload();
    data.projects[0]!.name.value = '机器人路径规划';
    data.projects[1]!.name = { ...data.projects[1]!.description, value: '构建视觉到运动的执行闭环。' };
    expect(validateResumeExtraction(data, SOURCE)?.facts.projects).toHaveLength(5);
  });
});
