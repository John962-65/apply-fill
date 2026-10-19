import { describe, expect, it } from 'vitest';

import { distillElements, distillScopedElements } from '@/perceptor';
import { buildFieldIdentity } from '@/identity';
import { isFieldBindingValid } from '@/runtime/FieldBinding';

describe('field binding validation', () => {
  it('同一控件在同构步骤中复用时旧 stepId 不能通过动作守卫', () => {
    document.body.innerHTML = '<label>姓名<input name="name" /></label>';
    const element = document.querySelector('input')!;
    const field = distillElements([element], { formId: 'form', stepId: 'step_one' })[0]!.field;
    const signature = { ...field, fieldKey: buildFieldIdentity(field.descriptor).fieldKey };
    expect(isFieldBindingValid(element, signature, 'form', undefined, 'step_one')).toBe(true);
    expect(isFieldBindingValid(element, signature, 'form', undefined, 'step_two')).toBe(false);
    expect(isFieldBindingValid(element, signature, 'another-form', undefined, 'step_one')).toBe(false);
  });
  it('同一个 DOM 节点被复用为另一个 name 时旧身份失效', () => {
    document.body.innerHTML = '<label>姓名<input name="applicant" /></label>';
    const element = document.querySelector('input')!;
    const field = distillElements([element], { formId: 'form' })[0]!.field;
    const signature = { ...field, fieldKey: buildFieldIdentity(field.descriptor).fieldKey };
    expect(isFieldBindingValid(element, signature, 'form')).toBe(true);
    element.name = 'another-person';
    expect(isFieldBindingValid(element, signature, 'form')).toBe(false);
  });

  it('经历字段被移动到其他实例时不能沿用旧租约', () => {
    document.body.innerHTML = '<section><h2>项目经历</h2><div id="entry"><label>项目名称<input name="project" /></label></div></section>';
    const container = document.querySelector<HTMLElement>('#entry')!;
    const { element, field } = distillScopedElements(container, { formId: 'form', sectionType: 'project', instanceId: 'one' })[0]!;
    const signature = { ...field, fieldKey: buildFieldIdentity(field.descriptor).fieldKey };
    expect(isFieldBindingValid(element, signature, 'form', { sectionType: 'project', instanceId: 'one' })).toBe(true);
    expect(isFieldBindingValid(element, signature, 'form', { sectionType: 'project', instanceId: 'two' })).toBe(false);
    expect(isFieldBindingValid(element, signature, 'form')).toBe(false);
  });
});
