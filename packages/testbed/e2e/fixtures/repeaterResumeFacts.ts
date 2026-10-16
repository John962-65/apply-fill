const fact = <T>(value: T) => ({
  value,
  source: 'user' as const,
  verified: true,
  updatedAt: 1750000000000,
});

export const REPEATER_EDUCATION = [
  { uid: 1, school: '示例大学', degree: '本科', major: '计算机科学与技术' },
  { uid: 101, school: '示例理工大学', degree: '硕士', major: '软件工程' },
  { uid: 102, school: '示例职业学院', degree: '大专', major: '信息管理' },
] as const;

export const REPEATER_PROJECTS = [
  { uid: 1, name: '多机械臂协同规划', role: '前端负责人', desc: '负责多机械臂协同规划平台的前端架构与可视化模块开发。' },
  { uid: 103, name: '机械臂增量碰撞验证', role: '核心开发', desc: '实现增量式碰撞检测与验证流水线，覆盖主要回归场景。' },
  { uid: 104, name: '智能表单填写引擎', role: '主要开发', desc: '设计浏览器扩展的表单识别与自动填写引擎，支持复杂控件。' },
] as const;

export function repeaterEducationAt(index: number): (typeof REPEATER_EDUCATION)[number] {
  const entry = REPEATER_EDUCATION[index];
  if (entry === undefined) {
    throw new Error(`education entry ${index} missing`);
  }
  return entry;
}

export function repeaterProjectAt(index: number): (typeof REPEATER_PROJECTS)[number] {
  const entry = REPEATER_PROJECTS[index];
  if (entry === undefined) {
    throw new Error(`project entry ${index} missing`);
  }
  return entry;
}

export function repeaterResumeFacts() {
  return {
    schemaVersion: 1,
    updatedAt: 1750000000000,
    basic: {
      name: fact('张三'),
      phone: fact('13800001111'),
      email: fact('zhangsan@example.com'),
    },
    education: REPEATER_EDUCATION.map((entry) => ({
      id: `resume.education.${entry.uid}`,
      school: fact(entry.school),
      degree: fact(entry.degree),
      major: fact(entry.major),
    })),
    projects: REPEATER_PROJECTS.map((entry) => ({
      id: `resume.project.${entry.uid}`,
      name: fact(entry.name),
      role: fact(entry.role),
      description: fact(entry.desc),
    })),
    preferences: {
      expectedSalary: fact(15),
      freshGraduate: fact(false),
      subscribeNotifications: fact(true),
    },
  };
}
