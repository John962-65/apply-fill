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
  endDate?: Fact<string>;
}

interface ResumeFactsShape {
  schemaVersion: number;
  updatedAt: number;
  basic: Record<string, Fact<string>>;
  education: EducationEntryFacts[];
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

export function comboboxResumeFacts(): ResumeFactsShape {
  const facts = base();
  facts.education[0] = {
    id: 'resume.education.1',
    school: fact('清华大学'),
    degree: fact('本科'),
    major: fact('专业21'),
  };
  return facts;
}

export function cascaderResumeFacts(): ResumeFactsShape {
  const facts = base();
  facts.basic['location'] = fact('广东省/深圳市/南山区');
  return facts;
}

export function wavesResumeFacts(): ResumeFactsShape {
  const facts = base();
  facts.education[0] = {
    id: 'resume.education.1',
    school: fact('示例大学'),
    degree: fact('本科'),
    major: fact('软件工程'),
    endDate: fact('2026'),
  };
  facts.basic['idType'] = fact('其他');
  facts.basic['idExplanation'] = fact('仅用于考试报名');
  facts.basic['city'] = fact('深圳市');
  facts.basic['postalCode'] = fact('518000');
  facts.preferences = {
    freshGraduate: fact(false),
  };
  return facts;
}

export function beisenResumeFacts(): ResumeFactsShape {
  const facts = base();
  facts.education[0] = {
    id: 'resume.education.1',
    school: fact('示例大学'),
    degree: fact('本科'),
    major: fact('计算机科学与技术'),
    endDate: fact('2026-01'),
  };
  return facts;
}
