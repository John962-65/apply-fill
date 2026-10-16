import type { ControlKind } from '@/shared/contracts/field';
import { normalizeLabel } from '@/shared/utils/text';

export interface RouteRule {
  id: string;
  patterns: string[];
  targetPath: string;
  controlKinds?: ControlKind[];
  valueKind?: 'string' | 'number' | 'boolean';
}

export const INDEX_TOKEN = '{index}';

export function substituteIndex(targetPath: string, index: number): string {
  return targetPath.split(INDEX_TOKEN).join(String(index));
}

export const DEFAULT_RULES: RouteRule[] = [
  { id: 'basic.name', patterns: ['姓名', '名字', '真实姓名', '申请人姓名'], targetPath: 'basic.name' },
  {
    id: 'basic.phone',
    patterns: ['手机', '手机号', '手机号码', '联系电话', '电话', '移动电话', '联系方式'],
    targetPath: 'basic.phone',
  },
  {
    id: 'basic.email',
    patterns: ['邮箱', '电子邮箱', '电子邮件', 'email', 'e-mail', '邮件地址'],
    targetPath: 'basic.email',
  },
  { id: 'basic.gender', patterns: ['性别'], targetPath: 'basic.gender', controlKinds: ['radio', 'select'] },
  {
    id: 'basic.intro',
    patterns: ['个人简介', '自我介绍', '自我评价', '个人介绍'],
    targetPath: 'basic.intro',
    controlKinds: ['textarea', 'text'],
  },
  {
    id: 'basic.location',
    patterns: ['所在地区', '现居住地', '现居地', '居住地', '所在地', '地区', '省市', '省市区'],
    targetPath: 'basic.location',
  },
  {
    id: 'basic.city',
    patterns: ['城市', '所在城市', '现居城市'],
    targetPath: 'basic.city',
  },
  {
    id: 'basic.birthDate',
    patterns: ['出生日期', '出生年月', '出生年月日'],
    targetPath: 'basic.birthDate',
    controlKinds: ['date'],
  },
  {
    id: 'basic.postalCode',
    patterns: ['邮编', '邮政编码'],
    targetPath: 'basic.postalCode',
    controlKinds: ['text', 'number', 'combobox', 'select'],
  },
  {
    id: 'basic.idType',
    patterns: ['证件类型', '证件种类'],
    targetPath: 'basic.idType',
    controlKinds: ['select', 'radio', 'combobox'],
  },
  {
    id: 'basic.idExplanation',
    patterns: ['证件说明', '证件号码说明'],
    targetPath: 'basic.idExplanation',
  },
  {
    id: 'education.school',
    patterns: ['学校', '学校名称', '毕业院校', '院校', '毕业学校'],
    targetPath: 'education[{index}].school',
  },
  {
    id: 'education.degree',
    patterns: ['学历', '最高学历', '学位'],
    targetPath: 'education[{index}].degree',
    controlKinds: ['select', 'radio', 'text', 'combobox'],
  },
  {
    id: 'education.graduationYear',
    patterns: ['毕业年份', '毕业时间', '毕业年月', '毕业日期'],
    targetPath: 'education[{index}].endDate',
    controlKinds: ['combobox', 'select', 'text'],
  },
  {
    id: 'education.startDate',
    patterns: ['入学时间', '入学年份', '入学日期'],
    targetPath: 'education[{index}].startDate',
    controlKinds: ['combobox', 'select', 'text'],
  },
  {
    id: 'education.dateRange',
    patterns: ['在校时间', '就读时间', '教育时间'],
    targetPath: 'education[{index}].dateRange',
    controlKinds: ['combobox'],
  },
  {
    id: 'education.graduationMonth',
    patterns: ['毕业月份', '毕业月'],
    targetPath: 'education[{index}].endDate',
    controlKinds: ['combobox', 'select', 'text'],
  },
  {
    id: 'education.major',
    patterns: ['专业', '所学专业', '专业名称'],
    targetPath: 'education[{index}].major',
  },
  {
    id: 'project.name',
    patterns: ['项目名称', '项目标题', '项目名'],
    targetPath: 'projects[{index}].name',
  },
  {
    id: 'project.role',
    patterns: ['项目角色', '担任角色', '角色'],
    targetPath: 'projects[{index}].role',
    controlKinds: ['text', 'select'],
  },
  {
    id: 'project.description',
    patterns: ['项目描述', '项目内容', '项目介绍', '项目职责'],
    targetPath: 'projects[{index}].description',
    controlKinds: ['textarea', 'text'],
  },
  {
    id: 'preferences.expectedSalary',
    patterns: ['期望薪资', '期望月薪', '期望薪水', '期望工资'],
    targetPath: 'preferences.expectedSalary',
    controlKinds: ['number', 'text'],
    valueKind: 'number',
  },
  {
    id: 'preferences.freshGraduate',
    patterns: ['应届毕业生', '是否应届', '应届生', '是否应届毕业生'],
    targetPath: 'preferences.freshGraduate',
    controlKinds: ['checkbox', 'radio', 'select'],
    valueKind: 'boolean',
  },
  {
    id: 'preferences.subscribeNotifications',
    patterns: ['接收通知', '订阅通知', '同意接收'],
    targetPath: 'preferences.subscribeNotifications',
    controlKinds: ['checkbox'],
    valueKind: 'boolean',
  },
];

const LEADING_NOISE = /^(请输入|请填写|请选择|请上传|请提供|输入|填写)/;

export function normalizeForMatch(raw: string): string {
  const withoutParens = raw.replace(/[（(][^）)]*[）)]/g, ' ');
  const withoutNoise = withoutParens.replace(LEADING_NOISE, ' ');
  return normalizeLabel(withoutNoise);
}

export function matchRule(
  controlKind: ControlKind,
  normalizedLabel: string,
  rules: RouteRule[] = DEFAULT_RULES,
): RouteRule | undefined {
  const label = normalizeForMatch(normalizedLabel);
  for (const rule of rules) {
    if (rule.controlKinds !== undefined && !rule.controlKinds.includes(controlKind)) {
      continue;
    }
    for (const pattern of rule.patterns) {
      if (normalizeForMatch(pattern) === label) {
        return rule;
      }
    }
  }
  return undefined;
}
