import type { ResumeFact, ResumeFactsDocument } from '@/shared/contracts/resume';
import { RESUME_SCHEMA_VERSION } from '@/shared/contracts/resume';

export function sampleFact<T>(value: T): ResumeFact<T> {
  return {
    value,
    source: 'user',
    verified: true,
    reviewStatus: 'confirmed',
    updatedAt: Date.now(),
  };
}

export function createSampleResumeFacts(): ResumeFactsDocument {
  return {
    schemaVersion: RESUME_SCHEMA_VERSION,
    updatedAt: Date.now(),
    basic: {
      name: sampleFact('张三'),
      phone: sampleFact('13800001111'),
      email: sampleFact('zhangsan@example.com'),
      gender: sampleFact('男'),
      birthDate: sampleFact('2000-05'),
      intro: sampleFact('前端工程师，熟悉浏览器扩展开发与自动化测试，参与过多个工程化工具项目。'),
    },
    education: [
      {
        id: 'resume.education.1',
        school: sampleFact('示例大学'),
        degree: sampleFact('本科'),
        major: sampleFact('计算机科学与技术'),
        startDate: sampleFact('2018-09'),
        endDate: sampleFact('2022-06'),
      },
      {
        id: 'resume.education.2',
        school: sampleFact('示例理工大学'),
        degree: sampleFact('硕士'),
        major: sampleFact('软件工程'),
        startDate: sampleFact('2022-09'),
        endDate: sampleFact('至今'),
      },
      {
        id: 'resume.education.3',
        school: sampleFact('示例职业学院'),
        degree: sampleFact('大专'),
        major: sampleFact('信息管理'),
        startDate: sampleFact('2015-09'),
        endDate: sampleFact('2018-06'),
      },
    ],
    projects: [
      {
        id: 'resume.project.1',
        name: sampleFact('多机械臂协同规划'),
        role: sampleFact('前端负责人'),
        description: sampleFact('负责多机械臂协同规划平台的前端架构与可视化模块开发。'),
        startDate: sampleFact('2024-03'),
        endDate: sampleFact('2024-09'),
      },
      {
        id: 'resume.project.2',
        name: sampleFact('机械臂增量碰撞验证'),
        role: sampleFact('核心开发'),
        description: sampleFact('实现增量式碰撞检测与验证流水线，覆盖主要回归场景。'),
        startDate: sampleFact('2024-09'),
        endDate: sampleFact('2025-02'),
      },
      {
        id: 'resume.project.3',
        name: sampleFact('智能表单填写引擎'),
        role: sampleFact('主要开发'),
        description: sampleFact('设计浏览器扩展的表单识别与自动填写引擎，支持复杂控件。'),
        startDate: sampleFact('2025-02'),
        endDate: sampleFact('2025-08'),
      },
    ],
    preferences: {
      expectedSalary: sampleFact(15),
      freshGraduate: sampleFact(false),
      subscribeNotifications: sampleFact(true),
    },
  };
}
