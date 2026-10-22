/** Synthetic layout regression: dotted leaders, repeated schools, labeled research and open-source entries. */
export const RESEARCH_RESUME_LINES = [
  '姓名：测试用户', '籍贯：示例省示例市', '政治面貌：群众', '教 育 /工 作 背 景',
  '示例交通大学…………机械电子工程(工学硕士)…………2024.9-2027.6',
  '主修课程：数值分析、机器人学等',
  '示例交通大学…………控制工程(工学学士)…………2020.9-2024.6',
  '主修课程：机械设计、自动控制原理等',
  '技能特长', '专业技能：掌握 C++、Python', '英语水平：全国大学英语四级(CET-4)',
  '科 研 /项 目 经 历', '科研项目：协作机器人路径规划',
  '内容概述：面向共享空间，研究路径规划。',
  '主要工作：开发规划方法，高冲',
  '突场景成功率 98%，计算量降低 70%；',
  '通过历史复用减少 90%碰撞验证。',
  '科研项目：视觉驱动机器人操作', '内容概述：构建视觉到运动的执行闭环。',
  '科研项目：世界模型操作恢复', '内容概述：构建风险预测与主动恢复闭环。',
  '横向项目：设备失效分析(示例企业，2025)', '内容概述：负责设备信息融合与质量审查。',
  '横向项目：齿轮监测算法(示例客户，2026)', '内容概述：实现监测算法和软件交付。',
  '开 源 项 目', '项目名称：实验评审工作台（https://example.org/review）',
  '内容概述：构建实验评审流程，支持独', '立复核与证据追溯。',
  '项目名称：网申填写扩展（https://example.org/fill）', '内容概述：实现字段映射与异常诊断。',
  '校 园 经 历', '荣誉奖项：校级奖学金；', '学业奖学金一等奖', '校园活动：组织科技活动',
];

interface Line { lineId: string; page: number; text: string }
export function researchResumePayload(lines: Line[]) {
  const field = (value: string, first: string, last = first) => {
    const start = lines.findIndex((line) => line.text.includes(first));
    const end = lines.findIndex((line, index) => index >= start && line.text.includes(last));
    if (start < 0 || end < start) throw new Error(`Missing synthetic source line: ${first}`);
    return { value, quote: lines.slice(start, end + 1).map((line) => line.text).join('\n'), page: lines[start]!.page, lineId: lines[start]!.lineId };
  };
  return {
    basic: { name: field('测试用户', '姓名：测试用户'),
      additionalInfo: field('籍贯：示例省示例市；政治面貌：群众', '籍贯：示例省示例市', '政治面貌：群众'),
      awards: field('校级奖学金；学业奖学金一等奖', '荣誉奖项：校级奖学金；', '学业奖学金一等奖') },
    education: [
      { school: field('示例交通大学', '示例交通大学…………机械电子工程'), degree: field('工学硕士', '示例交通大学…………机械电子工程'),
        startDate: field('2024-09', '示例交通大学…………机械电子工程'), endDate: field('2027-06', '示例交通大学…………机械电子工程') },
      { school: field('示例交通大学', '示例交通大学…………控制工程'), degree: field('工学学士', '示例交通大学…………控制工程'),
        startDate: field('2020-09', '示例交通大学…………控制工程'), endDate: field('2024-06', '示例交通大学…………控制工程') },
    ], work: [],
    projects: [
      { name: field('协作机器人路径规划', '科研项目：协作机器人路径规划'),
        description: field('面向共享空间，研究路径规划。', '内容概述：面向共享空间'),
        outcomes: field('成功率 98%；计算量降低 70%；减少 90%碰撞验证', '主要工作：开发规划方法', '通过历史复用减少 90%碰撞验证。') },
      { name: field('视觉驱动机器人操作', '科研项目：视觉驱动机器人操作'), description: field('构建视觉到运动的执行闭环。', '内容概述：构建视觉到运动') },
      { name: field('世界模型操作恢复', '科研项目：世界模型操作恢复'), description: field('构建风险预测与主动恢复闭环。', '内容概述：构建风险预测') },
      { name: field('设备失效分析', '横向项目：设备失效分析'), description: field('负责设备信息融合与质量审查。', '内容概述：负责设备信息融合') },
      { name: field('齿轮监测算法', '横向项目：齿轮监测算法'), description: field('实现监测算法和软件交付。', '内容概述：实现监测算法') },
      { name: field('实验评审工作台', '项目名称：实验评审工作台'), description: field('构建实验评审流程，支持独立复核与证据追溯。', '内容概述：构建实验评审流程', '立复核与证据追溯。') },
      { name: field('网申填写扩展', '项目名称：网申填写扩展'), description: field('实现字段映射与异常诊断。', '内容概述：实现字段映射') },
    ],
    skills: [{ name: field('C++', '专业技能：掌握'), category: field('专业技能', '专业技能：掌握') }], warnings: [],
  };
}
