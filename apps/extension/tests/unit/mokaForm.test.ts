import { describe, expect, it } from 'vitest';
import { collectOptions } from '@/actuator/OverlayOptions';
import { formatForField } from '@/formatter';
import { extractWitness } from '@/identity/ContentWitness';
import { readComboboxCommitted } from '@/perceptor/ComboboxState';
import { distillElements, distillField, distillScopedElements, readFieldValueText } from '@/perceptor/FieldDistiller';
import { scanFormElements } from '@/perceptor/FormScanner';
import { scanRepeatableSections } from '@/perceptor/SectionScanner';
import { compileResume } from '@/resume/compiler/compile';
import { checkPathFillability } from '@/resume/validation/fillability';
import { matchRule } from '@/router/FastRuleMatcher';
import { isRouteContextValid } from '@/router/RouteContext';
import { buildExecutionPlan } from '@/runtime/planner';
import { createSampleResumeFacts } from '@/shared/samples/sampleResume';
import { executionCounts, mappingIssueText } from '@/shared/utils/runReport';
import { NativeCommitPredicate } from '@/verifier/CommitPredicate';
import { mokaBlock, mokaField, mokaInput, mokaRange, mokaSelect } from '../fixtures/mokaForm';
import { makeSignature, mustQuery } from './helpers';

function sample() {
  const facts = createSampleResumeFacts();
  facts.education[0]!.startDate = { ...facts.basic.name, value: '2018-09' };
  facts.education[0]!.endDate = { ...facts.basic.name, value: '2022-06' };
  facts.education.push({ ...facts.education[0]!, id: 'masters', degree: { ...facts.basic.name, value: '硕士' } });
  facts.basic.birthDate = { ...facts.basic.name, value: '1998-03-15' };
  return facts;
}

describe('Moka application fields', () => {
  it('读取真实标题和章节，不使用请选择、当前选中值或内容作为标签', () => {
    document.body.innerHTML = mokaBlock('个人信息 / Personal info', [mokaField('性别 / Gender', mokaSelect(undefined, '男/Male'), true)]) +
      mokaBlock('项目经验 / Projects', [mokaField('项目描述 / Project description', '<textarea placeholder="内容 / Content"></textarea>')], true);
    const fields = distillElements(scanFormElements(document));
    expect(fields.map(({ field }) => [field.label, field.descriptor.normalizedLabel, field.controlKind, field.sectionType, field.requirement])).toEqual([
      ['性别 / Gender', '性别', 'combobox', 'basic', 'required'], ['项目描述 / Project description', '项目描述', 'textarea', 'project', 'optional'],
    ]);
    expect(readFieldValueText(fields[0]!.element)).toBe('男');
  });

  it('maxlength=-1 表示不限长，0 和正数限制仍然生效', () => {
    document.body.innerHTML = mokaField('姓名 / Name', mokaInput('请输入'));
    expect(distillField(mustQuery('input'))?.constraints?.maxLength).toBeUndefined();
    mustQuery('input').setAttribute('maxlength', '');
    expect(distillField(mustQuery('input'))?.constraints?.maxLength).toBeUndefined();
    mustQuery('input').setAttribute('maxlength', '0');
    expect(formatForField('张三', distillField(mustQuery('input'))!).ok).toBe(false);
    mustQuery('input').setAttribute('maxlength', '2');
    expect(formatForField('张三', distillField(mustQuery('input'))!).ok).toBe(true);
  });

  it('双语姓名邮箱手机号直接映射，英文姓名和国际区号不会套用中文姓名及完整手机号', () => {
    expect(matchRule('text', '姓名 / Name')?.targetPath).toBe('basic.name');
    expect(matchRule('text', '邮箱 / Email')?.targetPath).toBe('basic.email');
    expect(matchRule('text', '请输入手机号 / Enter mobile number')?.targetPath).toBe('basic.phone');
    expect(matchRule('combobox', '性别 / Gender')?.targetPath).toBe('basic.gender');
    expect(matchRule('text', '姓名（中文） / Name( English)')).toBeUndefined();
    document.body.innerHTML = mokaBlock('个人信息 / Personal info', [mokaField('姓名（中文） / Name( English)', mokaInput('姓名'), true)]);
    expect(buildExecutionPlan(compileResume(sample()), distillElements(scanFormElements(document))).executable).toHaveLength(0);
    document.body.innerHTML = mokaField('手机号码 / Mobile', `<div class="wrapper-test"><div class="code-test">${mokaSelect('', '+86')}</div>${mokaInput('请输入手机号')}</div>`, true);
    const fields = distillElements(scanFormElements(document));
    expect(matchRule(fields[0]!.field.controlKind, fields[0]!.field.descriptor.normalizedLabel)).toBeUndefined();
    expect(fields[1]!.field.descriptor.normalizedLabel).toBe('手机号码');
  });

  it('排除导航搜索、登录框和下拉菜单搜索，保留申请表单控件', () => {
    document.body.innerHTML = '<div class="navbar-test"><form><input placeholder="输入职位关键字"></form></div>' +
      '<div class="sd-Modal-modal-test"><input placeholder="请输入邮箱"></div>' +
      '<div class="sd-Dropdown-dropdown-test"><input placeholder="搜索"></div>' + mokaField('邮箱 / Email', mokaInput('邮箱 / Email'));
    expect(scanFormElements(document).map((element) => element.getAttribute('placeholder'))).toEqual(['邮箱 / Email']);
  });

  it('按真实区块识别两个教育实例，日期子控件明确绑定起止年月', () => {
    const fields = mokaField('学校名称 / School', mokaSelect('请输入就读学校'), true) + mokaField('就读时间 / Education period', mokaRange(), true);
    document.body.innerHTML = mokaBlock('教育背景 / Education', [fields, fields], true);
    const section = scanRepeatableSections(document)[0]!;
    expect(section.sectionType).toBe('education');
    expect(section.containers).toHaveLength(2);
    expect(section.addControl?.textContent).toBe('添加 / Add');
    const items = distillScopedElements(section.containers[0]!, { sectionType: 'education', instanceId: 'ed-1' });
    const result = buildExecutionPlan(compileResume(sample()), [], { instances: [{ sectionType: 'education', instanceId: 'ed-1', resumeEntryId: sample().education[0]!.id, reanchorStatus: 'MATCHED', distilled: items }] });
    expect(result.executable.map((entry) => [entry.signature.label, entry.expectedText])).toEqual([
      ['学校名称 / School', sample().education[0]!.school.value], ['入学时间（年）', '2018'], ['入学时间（月）', '9'], ['毕业时间（年）', '2022'], ['毕业时间（月）', '6'],
    ]);
    expect(extractWitness('education', [{ normalizedLabel: '学校名称 / School', controlKind: 'text', valueText: '示例大学' }]).primary?.value).toBe('示例大学');
  });

  it('最高学历按层级取硕士，不因两段教育而要求再次选择经历', () => {
    document.body.innerHTML = mokaBlock('个人信息 / Personal info', [mokaField('最高学历 / Highest degree', mokaSelect(), true)]);
    const source = sample();
    source.education[1]!.degree.value = '工学硕士';
    const plan = buildExecutionPlan(compileResume(source), distillElements(scanFormElements(document)));
    expect(plan.executable[0]?.targetPath).toBe('education[1].degree');
    expect(plan.executable[0]?.expectedText).toBe('硕士');
    expect(plan.issues).toEqual([]);
    expect(source.education[1]!.degree.value).toBe('工学硕士');
    expect(formatForField('工学硕士', { controlKind: 'text', label: '学位' })).toMatchObject({ ok: true, expectedText: '工学硕士' });
  });

  it('更高学历尚未确认时，不把已确认的较低学历当作最高学历填写', () => {
    document.body.innerHTML = mokaBlock('个人信息 / Personal info', [mokaField('最高学历 / Highest degree', mokaSelect(), true)]);
    const source = sample();
    source.education[1]!.degree.reviewStatus = 'pending';
    source.education[1]!.degree.verified = false;
    const plan = buildExecutionPlan(compileResume(source), distillElements(scanFormElements(document)));
    expect(plan.executable).toHaveLength(0);
    expect(plan.mappings[0]?.targetPath).toBe('education[1].degree');
    expect(plan.issues[0]?.reason).toBe('FACT_NOT_CONFIRMED');
  });

  it('出生日期拆分保持原文精度，不把整段日期写入年或虚构月日', () => {
    const doc = sample();
    doc.basic.birthDate!.value = '1998';
    const compiled = compileResume(doc);
    expect(formatForField(compiled.normalized.basic.birthDate, { controlKind: 'text', label: '出生日期（年） / Date of Birth(Year)' })).toMatchObject({ ok: true, expectedText: '1998' });
    expect(checkPathFillability(compiled, 'basic.birthDate', { controlKind: 'text', label: '出生日期（月） / Date of Birth(Month)' })).toMatchObject({ ok: false, reason: 'DATE_PRECISION_INSUFFICIENT' });
    expect(formatForField(compiled.normalized.basic.birthDate, { controlKind: 'text', label: '出生日期（日） / Date of Birth(Date)' }).ok).toBe(false);
    expect(formatForField(compiled.normalized.basic.birthDate, { controlKind: 'number', label: '出生日期（年）', constraints: { max: '1900' } }).ok).toBe(false);
  });

  it('查询输入不等于已提交选项，组件选中值才能提供提交证据', async () => {
    document.body.innerHTML = mokaField('性别 / Gender', mokaSelect(undefined, '', 'value="男"'));
    const input = mustQuery<HTMLElement>('input');
    expect(readComboboxCommitted(input)).toEqual({ source: 'VISIBLE', value: '男' });
    const predicate = new NativeCommitPredicate();
    const context = { fieldKey: 'moka-gender', controlKind: 'combobox' as const, signature: makeSignature('combobox'), element: input, expectedValue: '男', expectedText: '男', signal: new AbortController().signal };
    expect((await predicate.verify(context)).status).toBe('UNKNOWN');
    mustQuery('[class*="sd-Input-display-value-"]').textContent = '女/Female';
    expect(readComboboxCommitted(input)).toEqual({ source: 'COMPONENT_STATE', value: '女' });
    expect((await predicate.verify(context)).status).toBe('REJECTED');
    mustQuery('[class*="sd-Input-display-value-"]').textContent = '男/Male';
    expect((await predicate.verify(context)).status).toBe('CONFIRMED');
  });

  it('读取真实 sd-Select 选项，避免将嵌套文字重复收集为多个候选', () => {
    document.body.innerHTML = '<div class="sd-Dropdown-dropdown-test"><div class="sd-Select-menu-test">' +
      ['男/Male', '女/Female'].map((label) => `<div class="sd-Select-common-item-test"><div class="sd-Menu-container-test"><div class="option-label-test">${label}</div></div></div>`).join('') + '</div></div>';
    expect(collectOptions(document).map((option) => option.text)).toEqual(['男', '女']);
  });

  it('校园经历不借用科研项目，选填与已有内容保留报告但不算人工任务', () => {
    document.body.innerHTML = mokaBlock('个人信息 / Personal info', [mokaField('推荐码 / Referral code', mokaInput('推荐码')) +
      mokaField('民族 / Ethnicity', mokaInput('民族'), true) + mokaField('政治面貌 / Political affiliation', mokaInput('政治面貌', 'value="已有内容"'), true)]) +
      mokaBlock('校园经历 / Campus Experience', [mokaField('项目名称 / Project name', mokaInput('项目名称'))]);
    const plan = buildExecutionPlan(compileResume(sample()), distillElements(scanFormElements(document)));
    expect(plan.executable).toHaveLength(0);
    expect(plan.issues.map((issue) => issue.attention)).toEqual(['optional', 'manual', 'filled', 'optional']);
    expect(executionCounts([], plan.issues).needsManual).toBe(1);
    expect(plan.issues.map(mappingIssueText).join('')).not.toContain('NO_RULE_MATCH');
    expect(isRouteContextValid('projects[0].name', 'unknown', 0)).toBe(false);
  });

  it('简历没有实习经历时，空白选填条目重新发现后仍可跳过', () => {
    const facts = sample();
    facts.work = [];
    document.body.innerHTML = mokaBlock('实习经历 / Internship experience', [mokaField('公司名称 / Company', mokaInput('公司名称'))]);
    const items = distillElements(scanFormElements(document));
    const plan = buildExecutionPlan(compileResume(facts), [], { instances: [{ sectionType: 'work', instanceId: 'empty-work', reanchorStatus: 'AMBIGUOUS', distilled: items, reason: 'NO_RELIABLE_EVIDENCE' }] });
    expect(plan.issues[0]?.attention).toBe('optional');
    expect(executionCounts([], plan.issues).needsManual).toBe(0);
  });
});
