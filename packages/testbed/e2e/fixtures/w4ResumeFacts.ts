interface Fact<T> {
  value: T;
  source: 'user';
  verified: boolean;
  reviewStatus: 'confirmed';
  updatedAt: number;
}

interface EducationEntryFacts {
  id: string;
  school: Fact<string>;
  degree: Fact<string>;
  major: Fact<string>;
  startDate?: Fact<string>;
  endDate?: Fact<string>;
}

interface ProjectEntryFacts {
  id: string;
  name: Fact<string>;
  role?: Fact<string>;
  description?: Fact<string>;
}

interface ResumeFactsShape {
  schemaVersion: number;
  updatedAt: number;
  basic: Record<string, Fact<string>>;
  education: EducationEntryFacts[];
  projects?: ProjectEntryFacts[];
  preferences?: Record<string, Fact<unknown>>;
}

const fact = <T>(value: T): Fact<T> => ({
  value,
  source: 'user',
  verified: true,
  reviewStatus: 'confirmed' as const,
  updatedAt: 1750000000000,
});

function base(): ResumeFactsShape {
  return {
    schemaVersion: 2,
    updatedAt: 1750000000000,
    basic: {
      name: fact('张三'),
    },
    education: [
      {
        id: 'resume.education.1',
        school: fact('示例大学'),
        degree: fact('本科'),
        major: fact('计算机科学与技术'),
      },
    ],
    preferences: {
      expectedSalary: fact(15),
      freshGraduate: fact(true),
      subscribeNotifications: fact(true),
    },
  };
}

export function datepickerResumeFacts(): ResumeFactsShape {
  const facts = base();
  facts.education[0] = {
    id: 'resume.education.1',
    school: fact('示例大学'),
    degree: fact('本科'),
    major: fact('计算机科学与技术'),
    endDate: fact('2026-03-15'),
  };
  return facts;
}

export function daterangeResumeFacts(): ResumeFactsShape {
  const facts = base();
  facts.education[0] = {
    id: 'resume.education.1',
    school: fact('示例大学'),
    degree: fact('本科'),
    major: fact('计算机科学与技术'),
    startDate: fact('2020-09-01'),
    endDate: fact('2022-06-30'),
  };
  return facts;
}

export function daterangePresentResumeFacts(): ResumeFactsShape {
  const facts = base();
  facts.education[0] = {
    id: 'resume.education.1',
    school: fact('示例大学'),
    degree: fact('本科'),
    major: fact('计算机科学与技术'),
    startDate: fact('2020-09-01'),
    endDate: fact('至今'),
  };
  return facts;
}

export function spaResumeFacts(): ResumeFactsShape {
  const facts = base();
  facts.basic['email'] = fact('zhangsan@applyfill.dev');
  return facts;
}

export function validateResumeFacts(): ResumeFactsShape {
  const facts = base();
  facts.basic['phone'] = fact('13800138000');
  facts.basic['email'] = fact('zhangsan@applyfill.dev');
  facts.basic['city'] = fact('北京市');
  return facts;
}

export function jdResumeFacts(): ResumeFactsShape {
  const facts = validateResumeFacts();
  facts.projects = [
    {
      id: 'resume.projects.1',
      name: fact('招聘推荐系统'),
      role: fact('前端负责人'),
      description: fact('负责候选人匹配引擎前端架构，覆盖百万级数据渲染与性能优化。'),
    },
  ];
  return facts;
}

export function finalResumeFacts(): ResumeFactsShape {
  const facts = base();
  facts.basic['phone'] = fact('13800001111');
  facts.basic['email'] = fact('zhangsan@applyfill.dev');
  facts.basic['city'] = fact('北京市');
  facts.education = [
    {
      id: 'resume.education.1',
      school: fact('示例大学'),
      degree: fact('本科'),
      major: fact('计算机科学与技术'),
      endDate: fact('2020-06'),
    },
    {
      id: 'resume.education.2',
      school: fact('示例理工大学'),
      degree: fact('硕士'),
      major: fact('软件工程'),
      endDate: fact('2023-06'),
    },
  ];
  facts.projects = [
    {
      id: 'resume.projects.1',
      name: fact('招聘推荐系统'),
      role: fact('前端负责人'),
      description: fact('负责候选人匹配引擎前端架构，覆盖百万级数据渲染与性能优化。'),
    },
    {
      id: 'resume.projects.2',
      name: fact('内部工具平台'),
      role: fact('全栈开发'),
      description: fact('搭建表单引擎与流程编排系统，支撑内部十余条业务线。'),
    },
    {
      id: 'resume.projects.3',
      name: fact('开源组件库'),
      role: fact('核心贡献者'),
      description: fact('维护虚拟列表与可访问性组件，累计星标两千余枚。'),
    },
  ];
  facts.preferences = {
    expectedSalary: fact(15),
    freshGraduate: fact(false),
    subscribeNotifications: fact(true),
  };
  return facts;
}

export function framesResumeFacts(): ResumeFactsShape {
  const facts = base();
  facts.basic['email'] = fact('zhangsan@applyfill.dev');
  facts.education[0] = {
    id: 'resume.education.1',
    school: fact('示例大学'),
    degree: fact('本科'),
    major: fact('计算机科学与技术'),
  };
  return facts;
}
