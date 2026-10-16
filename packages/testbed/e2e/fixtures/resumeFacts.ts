const fact = <T>(value: T) => ({
  value,
  source: 'user' as const,
  verified: true,
  updatedAt: 1750000000000,
});

export function resumeFacts() {
  return {
    schemaVersion: 1,
    updatedAt: 1750000000000,
    basic: {
      name: fact('张三'),
      phone: fact('13800001111'),
      email: fact('zhangsan@example.com'),
      gender: fact('男'),
      birthDate: fact('1998-03-15'),
      intro: fact('前端工程师，熟悉浏览器扩展开发与自动化测试，参与过多个工程化工具项目。'),
    },
    education: [
      {
        id: 'resume.education.1',
        school: fact('示例大学'),
        degree: fact('本科'),
        major: fact('计算机科学与技术'),
        startDate: fact('2018-09'),
        endDate: fact('2022-06'),
      },
    ],
    preferences: {
      expectedSalary: fact(15),
      freshGraduate: fact(false),
      subscribeNotifications: fact(true),
    },
  };
}
