export interface LlmTargetPathInfo {
  path: string;
  description: string;
}

export const INDEX_TOKEN = '{index}';

export const LLM_TARGET_PATHS: LlmTargetPathInfo[] = [
  { path: 'basic.name', description: '姓名' },
  { path: 'basic.phone', description: '手机号/联系电话' },
  { path: 'basic.email', description: '邮箱' },
  { path: 'basic.gender', description: '性别' },
  { path: 'basic.birthDate', description: '出生日期' },
  { path: 'basic.city', description: '所在城市/现居城市' },
  { path: 'basic.location', description: '现居住地/所在地区/省市' },
  { path: 'basic.postalCode', description: '邮政编码' },
  { path: 'basic.idType', description: '证件类型' },
  { path: 'basic.idExplanation', description: '证件号码说明' },
  { path: 'basic.intro', description: '个人简介/自我介绍/自我评价' },
  { path: 'basic.awards', description: '用户确认的奖项与荣誉原文' },
  { path: 'basic.additionalInfo', description: '用户确认的补充信息原文' },
  { path: `education[${INDEX_TOKEN}].school`, description: '教育经历：学校名称' },
  { path: `education[${INDEX_TOKEN}].degree`, description: '教育经历：学历/学位' },
  { path: `education[${INDEX_TOKEN}].major`, description: '教育经历：专业' },
  { path: `education[${INDEX_TOKEN}].gpa`, description: '教育经历：原始 GPA 及分制' },
  { path: `education[${INDEX_TOKEN}].startDate`, description: '教育经历：入学时间' },
  { path: `education[${INDEX_TOKEN}].endDate`, description: '教育经历：毕业时间' },
  { path: `education[${INDEX_TOKEN}].dateRange`, description: '教育经历：就读起止区间文本' },
  { path: `work[${INDEX_TOKEN}].company`, description: '工作/实习经历：公司或单位名称' },
  { path: `work[${INDEX_TOKEN}].role`, description: '工作/实习经历：职位/岗位' },
  { path: `work[${INDEX_TOKEN}].description`, description: '工作/实习经历：工作内容/职责' },
  { path: `work[${INDEX_TOKEN}].startDate`, description: '工作/实习经历：开始时间' },
  { path: `work[${INDEX_TOKEN}].endDate`, description: '工作/实习经历：结束时间' },
  { path: `work[${INDEX_TOKEN}].dateRange`, description: '工作/实习经历：在职起止区间文本' },
  { path: `projects[${INDEX_TOKEN}].name`, description: '项目经历：项目名称' },
  { path: `projects[${INDEX_TOKEN}].role`, description: '项目经历：担任角色' },
  { path: `projects[${INDEX_TOKEN}].description`, description: '项目经历：项目描述' },
  { path: `projects[${INDEX_TOKEN}].startDate`, description: '项目经历：开始时间' },
  { path: `projects[${INDEX_TOKEN}].endDate`, description: '项目经历：结束时间' },
  { path: `projects[${INDEX_TOKEN}].dateRange`, description: '项目经历：起止区间文本' },
  { path: `skills[${INDEX_TOKEN}].name`, description: '技能/证书：名称' },
  { path: `skills[${INDEX_TOKEN}].category`, description: '技能/证书：类别' },
  { path: `skills[${INDEX_TOKEN}].level`, description: '技能/证书：熟练程度/等级' },
  { path: 'preferences.expectedSalary', description: '期望薪资' },
  { path: 'preferences.freshGraduate', description: '是否应届毕业生' },
  { path: 'preferences.subscribeNotifications', description: '是否接收通知' },
  ...(['title', 'one_liner', 'summary_150', 'responsibilities', 'outcomes', 'full_description'] as const).map((key) => ({
    path: `projections.projects[${INDEX_TOKEN}].${key}`, description: `项目文本切面：${key}`,
  })),
  { path: 'projections.introShort', description: '个人简介短文本切面' },
];

export const LLM_ALLOWED_TARGET_PATHS = new Set(LLM_TARGET_PATHS.map((info) => info.path));

export function isAllowedLlmTargetPath(targetPath: string): boolean {
  return LLM_ALLOWED_TARGET_PATHS.has(targetPath);
}
