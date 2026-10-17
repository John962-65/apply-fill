import type { CompiledResume, DateAtom } from '@/shared/contracts/resume';

export interface ResumePathOption {
  path: string;
  label: string;
  preview: string;
}

const MAX_OPTIONS = 80;

function isDateAtom(value: object): value is DateAtom {
  return 'year' in value && typeof (value as { year?: unknown }).year === 'number';
}

function formatDateAtom(atom: DateAtom | { present: true }): string {
  if ('present' in atom) {
    return '至今';
  }
  const month = atom.month !== undefined ? `-${String(atom.month).padStart(2, '0')}` : '';
  const day = atom.day !== undefined ? `-${String(atom.day).padStart(2, '0')}` : '';
  return `${atom.year}${month}${day}`;
}

function previewOf(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value === '' ? undefined : value.slice(0, 40);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value !== null && typeof value === 'object' && isDateAtom(value)) {
    return formatDateAtom(value);
  }
  if (value !== null && typeof value === 'object' && 'present' in value) {
    return '至今';
  }
  return undefined;
}

const BASIC_LABELS: Record<string, string> = {
  name: '姓名',
  phone: '手机号',
  email: '邮箱',
  gender: '性别',
  birthDate: '出生日期',
  intro: '个人简介',
  location: '所在地区',
  city: '所在城市',
  postalCode: '邮编',
  idType: '证件类型',
  idExplanation: '证件说明',
};

export function listResumeValuePaths(compiled: CompiledResume): ResumePathOption[] {
  const options: ResumePathOption[] = [];
  const push = (path: string, label: string, value: unknown): void => {
    const preview = previewOf(value);
    if (preview === undefined) {
      return;
    }
    options.push({ path, label, preview });
  };

  for (const [key, value] of Object.entries(compiled.normalized.basic)) {
    push(`basic.${key}`, BASIC_LABELS[key] ?? key, value);
  }
  compiled.normalized.education.forEach((entry, index) => {
    const prefix = `education[${index}]`;
    push(`${prefix}.school`, `教育 ${index + 1} 学校`, entry.school);
    push(`${prefix}.degree`, `教育 ${index + 1} 学历`, entry.degree);
    push(`${prefix}.major`, `教育 ${index + 1} 专业`, entry.major);
    push(`${prefix}.startDate`, `教育 ${index + 1} 入学时间`, entry.startDate);
    push(`${prefix}.endDate`, `教育 ${index + 1} 毕业时间`, entry.endDate);
  });
  compiled.normalized.projects.forEach((entry, index) => {
    const prefix = `projects[${index}]`;
    push(`${prefix}.name`, `项目 ${index + 1} 名称`, entry.name);
    push(`${prefix}.role`, `项目 ${index + 1} 角色`, entry.role);
    push(`${prefix}.description`, `项目 ${index + 1} 描述`, entry.description);
    push(`${prefix}.startDate`, `项目 ${index + 1} 开始时间`, entry.startDate);
    push(`${prefix}.endDate`, `项目 ${index + 1} 结束时间`, entry.endDate);
  });
  compiled.normalized.work.forEach((entry, index) => {
    const prefix = `work[${index}]`;
    push(`${prefix}.company`, `工作 ${index + 1} 单位`, entry.company);
    push(`${prefix}.role`, `工作 ${index + 1} 职位`, entry.role);
    push(`${prefix}.description`, `工作 ${index + 1} 描述`, entry.description);
    push(`${prefix}.startDate`, `工作 ${index + 1} 开始时间`, entry.startDate);
    push(`${prefix}.endDate`, `工作 ${index + 1} 结束时间`, entry.endDate);
  });
  compiled.normalized.skills.forEach((entry, index) => {
    const prefix = `skills[${index}]`;
    push(`${prefix}.name`, `技能/证书 ${index + 1} 名称`, entry.name);
    push(`${prefix}.category`, `技能/证书 ${index + 1} 类别`, entry.category);
    push(`${prefix}.level`, `技能/证书 ${index + 1} 等级`, entry.level);
  });
  for (const [key, value] of Object.entries(compiled.normalized.preferences)) {
    const label = key === 'expectedSalary' ? '期望薪资' : key === 'freshGraduate' ? '应届生' : '订阅通知';
    push(`preferences.${key}`, label, value);
  }
  for (const [key, value] of Object.entries(compiled.projections)) {
    const label = key === 'introShort' ? '简介摘要' : key;
    push(`projections.${key}`, label, value);
  }
  return options.slice(0, MAX_OPTIONS);
}
