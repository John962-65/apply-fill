import { describe, expect, it } from 'vitest';

import { extractResumeFacts, markFactsVerified } from '@/resume/parser/resumeStructureExtractor';
import { listReviewFields } from '@/resume/review/facts';

const SAMPLE = `张伟
性别：男
手机：13812345678
邮箱：zhangwei@example.com
出生日期：2000-03
个人简介：熟悉前端开发与自动化测试。
现居城市：上海

教育经历
2019.09 - 2023.06 示例大学 本科 计算机科学与技术
2018.09 - 2019.06 示例学院 专科

工作及实习经历
ABC科技有限公司 | 前端实习生 | 2023.07 - 2023.10
负责管理后台开发
某某网络公司 | 前端工程师 | 2023.10 - 至今

项目经历
项目名称：智能表单填写引擎
角色：核心开发
2024.02 - 2024.08
设计并实现表单识别引擎

技能证书
JavaScript、TypeScript、React、Node.js（熟练）
软件设计师证书
`;

describe('extractResumeFacts', () => {
  it('职责正文提到公司或项目时不拆成额外经历', () => {
    const text = `姓名：李雷\n工作经历\n示例科技有限公司 | 软件工程师 | 2022.03 - 2023.08\n负责公司管理后台开发\n参与集团数据平台建设\n项目经历\n项目名称：智能推荐平台\n角色：核心开发\n负责项目架构设计\n• 优化项目推荐性能\n项目成果：完成灰度发布`;
    const { facts } = extractResumeFacts(text);
    expect(facts.work).toHaveLength(1);
    expect(facts.work?.[0]?.description?.value).toContain('负责公司管理后台开发');
    expect(facts.projects).toHaveLength(1);
    expect(facts.projects?.[0]?.description?.value).toContain('负责项目架构设计');
    expect(facts.projects?.[0]?.description?.value).toContain('优化项目推荐性能');
  });

  it('中英双语章节标题仍识别为对应经历', () => {
    const { facts } = extractResumeFacts('姓名：李雷\n教育背景 / Education\n示例大学 | 本科 | 2020.09 - 2024.06\n项目经历 / Projects\n项目名称：推荐平台\n负责模型服务开发');
    expect(facts.education[0]?.school.value).toBe('示例大学');
    expect(facts.projects?.[0]?.name.value).toBe('推荐平台');
  });
  it('提取基本信息并标记来源为 resume-import 且未核验', () => {
    const { facts, stats } = extractResumeFacts(SAMPLE, 1000);
    expect(facts.basic.name.value).toBe('张伟');
    expect(facts.basic.phone?.value).toBe('13812345678');
    expect(facts.basic.email?.value).toBe('zhangwei@example.com');
    expect(facts.basic.gender?.value).toBe('男');
    expect(facts.basic.birthDate?.value).toBe('2000-03');
    expect(facts.basic.intro?.value).toContain('前端开发');
    expect(facts.basic.city?.value).toBe('上海');
    expect(facts.basic.name.source).toBe('resume-import');
    expect(facts.basic.name.verified).toBe(false);
    expect(facts.basic.name.updatedAt).toBe(1000);
    expect(stats.basic).toContain('姓名');
    expect(stats.basic).toContain('手机号');
    expect(stats.basic).toContain('邮箱');
  });

  it('解析多段教育经历（学校/学历/专业/起止时间）', () => {
    const { facts, stats } = extractResumeFacts(SAMPLE, 1000);
    expect(stats.education).toBe(2);
    const first = facts.education[0];
    expect(first?.school.value).toBe('示例大学');
    expect(first?.degree.value).toBe('本科');
    expect(first?.major?.value).toBe('计算机科学与技术');
    expect(first?.startDate?.value).toBe('2019-09');
    expect(first?.endDate?.value).toBe('2023-06');
    const second = facts.education[1];
    expect(second?.school.value).toBe('示例学院');
    expect(second?.degree.value).toBe('专科');
    expect(second?.major).toBeUndefined();
  });

  it('解析工作/实习经历与“至今”结束时间', () => {
    const { facts, stats } = extractResumeFacts(SAMPLE, 1000);
    expect(stats.work).toBe(2);
    const first = facts.work?.[0];
    expect(first?.company.value).toBe('ABC科技有限公司');
    expect(first?.role?.value).toBe('前端实习生');
    expect(first?.description?.value).toContain('管理后台');
    const second = facts.work?.[1];
    expect(second?.company.value).toBe('某某网络公司');
    expect(second?.role?.value).toBe('前端工程师');
    expect(second?.endDate?.value).toBe('至今');
  });

  it('解析项目经历（名称/角色/时间/描述）', () => {
    const { facts, stats } = extractResumeFacts(SAMPLE, 1000);
    expect(stats.projects).toBe(1);
    const project = facts.projects?.[0];
    expect(project?.name.value).toBe('智能表单填写引擎');
    expect(project?.role?.value).toBe('核心开发');
    expect(project?.startDate?.value).toBe('2024-02');
    expect(project?.endDate?.value).toBe('2024-08');
    expect(project?.description?.value).toBe('设计并实现表单识别引擎');
  });

  it('解析技能与证书，识别括号内熟练度', () => {
    const { facts, stats } = extractResumeFacts(SAMPLE, 1000);
    expect(stats.skills).toBe(5);
    const skills = facts.skills ?? [];
    expect(skills.map((skill) => skill.name.value)).toEqual([
      'JavaScript',
      'TypeScript',
      'React',
      'Node.js',
      '软件设计师证书',
    ]);
    expect(skills[3]?.level?.value).toBe('熟练');
    expect(skills[4]?.category?.value).toBe('证书');
    expect(skills[0]?.category?.value).toBe('技能');
  });

  it('无法归属的行进入 uncertain 供人工确认', () => {
    const text = '姓名：李雷\n这些内容不属于任何章节';
    const { stats } = extractResumeFacts(text, 1000);
    expect(stats.basic).toContain('姓名');
    expect(stats.uncertain.length).toBeGreaterThan(0);
  });

  it('扫描件空文本返回空结构且不抛错', () => {
    const { facts, stats } = extractResumeFacts('\n\n  \n', 1000);
    expect(facts.basic.name.value).toBe('');
    expect(stats.education).toBe(0);
    expect(stats.uncertain).toContain('未识别到姓名');
  });
});

describe('markFactsVerified', () => {
  it('确认导入时递归标记 verified 但保留来源与 id', () => {
    const { facts } = extractResumeFacts(SAMPLE, 1000);
    const verified = markFactsVerified(facts, listReviewFields(facts).map((field) => field.path));
    expect(verified.basic.name.verified).toBe(true);
    expect(verified.education[0]?.school.verified).toBe(true);
    expect(verified.education[0]?.id).toBe('resume.education.1');
    expect(verified.work?.[0]?.company.verified).toBe(true);
    expect(verified.work?.[0]?.id).toBe('resume.work.1');
    expect(verified.projects?.[0]?.name.verified).toBe(true);
    expect(verified.skills?.[0]?.name.verified).toBe(true);
    expect(verified.basic.name.source).toBe('resume-import');
    expect(facts.basic.name.verified).toBe(false);
  });
});
