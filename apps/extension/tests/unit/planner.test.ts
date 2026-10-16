import { describe, expect, it } from 'vitest';

import { MappingMemory } from '@/memory/MappingMemory';
import { distillElements } from '@/perceptor/FieldDistiller';
import { scanFormElements } from '@/perceptor/FormScanner';
import { compileResume } from '@/resume/compiler/compile';
import { buildExecutionPlan } from '@/runtime/planner';
import { createSampleResumeFacts } from '@/shared/samples/sampleResume';
import type { FieldMapping } from '@/shared/contracts/field';

import { mustFind } from './helpers';

function setupForm(): void {
  document.body.innerHTML = `
    <form id="apply">
      <label for="p-name">姓名</label><input id="p-name" name="fullName" />
      <label for="p-phone">手机号码</label><input id="p-phone" name="phone" type="tel" />
      <label for="p-nick">昵称</label><input id="p-nick" name="nickname" />
      <label for="p-degree">学历</label>
      <select id="p-degree" name="degree">
        <option value="">请选择</option>
        <option>大专</option>
        <option>本科</option>
        <option>硕士</option>
        <option>博士</option>
      </select>
      <label for="p-salary">期望薪资（千元）</label><input id="p-salary" name="expectedSalary" type="number" />
      <label for="p-school">学校名称</label><input id="p-school" name="school" readonly />
      <label for="p-major">专业</label><input id="p-major" name="major" disabled />
    </form>`;
}

function planForCurrentDom(resume = createSampleResumeFacts()) {
  const distilled = distillElements(scanFormElements(document));
  const compiled = compileResume(resume, 42);
  return buildExecutionPlan(compiled, distilled);
}

function mappingByLabel(mappings: FieldMapping[], label: string): FieldMapping {
  return mustFind(mappings, (mapping) => mapping.signature.label === label);
}

describe('buildExecutionPlan', () => {
  it('标准字段映射为可执行项', () => {
    setupForm();
    const plan = planForCurrentDom();

    expect(plan.mappings).toHaveLength(7);
    expect(plan.executable).toHaveLength(4);

    const name = mappingByLabel(plan.mappings, '姓名');
    expect(name.status).toBe('MAPPED');
    expect(name.targetPath).toBe('basic.name');
    expect(name.expectedValue).toBe('张三');

    const phone = mappingByLabel(plan.mappings, '手机号码');
    expect(phone.status).toBe('MAPPED');
    expect(phone.expectedValue).toBe('13800001111');

    const degree = mappingByLabel(plan.mappings, '学历');
    expect(degree.status).toBe('MAPPED');
    expect(degree.expectedText).toBe('本科');

    const salary = mappingByLabel(plan.mappings, '期望薪资（千元）');
    expect(salary.status).toBe('MAPPED');
    expect(salary.expectedValue).toBe(15);
    expect(salary.expectedText).toBe('15');
  });

  it('未命中规则与不可编辑字段进入 issue 列表', () => {
    setupForm();
    const plan = planForCurrentDom();

    expect(mappingByLabel(plan.mappings, '昵称').status).toBe('UNMAPPED');
    expect(mappingByLabel(plan.mappings, '学校名称').status).toBe('READONLY');
    expect(mappingByLabel(plan.mappings, '专业').status).toBe('DISABLED');

    expect(mustFind(plan.issues, (issue) => issue.label === '昵称').kind).toBe('UNMAPPED');
    expect(mustFind(plan.issues, (issue) => issue.label === '学校名称').kind).toBe('READONLY');
    expect(mustFind(plan.issues, (issue) => issue.label === '专业').kind).toBe('DISABLED');
  });

  it('elementByKey 能定位到原元素', () => {
    setupForm();
    const plan = planForCurrentDom();
    const name = mappingByLabel(plan.mappings, '姓名');
    expect(plan.elementByKey.get(name.fieldKey)?.id).toBe('p-name');
    expect(plan.elementByKey.size).toBe(7);
  });

  it('简历缺少字段时映射为 NO_DATA', () => {
    setupForm();
    const facts = createSampleResumeFacts();
    delete facts.basic.phone;
    const plan = planForCurrentDom(facts);

    const phone = mappingByLabel(plan.mappings, '手机号码');
    expect(phone.status).toBe('NO_DATA');
    expect(mustFind(plan.issues, (issue) => issue.label === '手机号码').kind).toBe('NO_DATA');
    expect(plan.executable.some((field) => field.targetPath === 'basic.phone')).toBe(false);
  });

  it('可执行项携带目标路径与期望文本', () => {
    setupForm();
    const plan = planForCurrentDom();
    const degree = mustFind(plan.executable, (field) => field.targetPath === 'education[0].degree');
    expect(degree.expectedText).toBe('本科');
    expect(degree.element.id).toBe('p-degree');
    const name = mustFind(plan.executable, (field) => field.targetPath === 'basic.name');
    expect(name.expectedValue).toBe('张三');
  });
});

describe('buildExecutionPlan 记忆映射', () => {
  function planWithMemory(memory: MappingMemory, host = 'job.example.com') {
    const distilled = distillElements(scanFormElements(document));
    const compiled = compileResume(createSampleResumeFacts(), 42);
    return buildExecutionPlan(compiled, distilled, { memory, host });
  }

  it('未命中规则的字段可通过记忆完成映射且来源为 memory', () => {
    document.body.innerHTML = `
      <form>
        <label for="m-name">姓名</label><input id="m-name" />
        <label for="m-ec">紧急联系人</label><input id="m-ec" />
      </form>`;
    const memory = new MappingMemory();
    memory.recordUserChoice(
      { host: 'job.example.com', sectionType: 'basic', normalizedLabel: '紧急联系人', controlKind: 'text' },
      'basic.name',
    );
    const plan = planWithMemory(memory);
    const mapping = mappingByLabel(plan.mappings, '紧急联系人');
    expect(mapping.status).toBe('MAPPED');
    expect(mapping.source).toBe('memory');
    expect(mapping.targetPath).toBe('basic.name');
    expect(mapping.expectedValue).toBe('张三');
    expect(plan.issues.some((issue) => issue.label === '紧急联系人')).toBe(false);
    expect(plan.cacheCandidates.some((candidate) => candidate.fieldKey === mapping.fieldKey)).toBe(false);
  });

  it('记忆路径在简历中无数据时回退规则匹配', () => {
    document.body.innerHTML = `
      <form>
        <label for="m-name">姓名</label><input id="m-name" />
      </form>`;
    const memory = new MappingMemory();
    memory.recordVerified(
      { host: 'job.example.com', sectionType: 'basic', normalizedLabel: '姓名', controlKind: 'text' },
      'basic.unknownField',
    );
    const plan = planWithMemory(memory);
    const mapping = mappingByLabel(plan.mappings, '姓名');
    expect(mapping.source).toBe('rule');
    expect(mapping.targetPath).toBe('basic.name');
  });

  it('记忆按主机隔离，未记录主机仍报告未映射', () => {
    document.body.innerHTML = `
      <form>
        <label for="m-ec">紧急联系人</label><input id="m-ec" />
      </form>`;
    const memory = new MappingMemory();
    memory.recordUserChoice(
      { host: 'job.example.com', sectionType: 'basic', normalizedLabel: '紧急联系人', controlKind: 'text' },
      'basic.name',
    );
    const plan = planWithMemory(memory, 'other.example.com');
    expect(mappingByLabel(plan.mappings, '紧急联系人').status).toBe('UNMAPPED');
    expect(mustFind(plan.issues, (issue) => issue.label === '紧急联系人').kind).toBe('UNMAPPED');
  });
});
