import { describe, expect, it } from 'vitest';

import { distillScopedElements, readFieldValueText, readStableAttribute } from '@/perceptor/FieldDistiller';

describe('distillScopedElements', () => {
  it('为范围内字段注入区块与实例身份', () => {
    document.body.innerHTML = `
      <div id="item">
        <label>项目名称<input name="projectName" /></label>
        <label>项目描述<textarea name="projectDesc"></textarea></label>
      </div>`;
    const container = document.getElementById('item') as HTMLElement;
    const items = distillScopedElements(container, { sectionType: 'project', instanceId: 'instance_02' });
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.field.instanceId).toBe('instance_02');
      expect(item.field.descriptor.instanceId).toBe('instance_02');
      expect(item.field.descriptor.sectionType).toBe('project');
    }
  });

  it('同名字段按局部序号回退消歧', () => {
    document.body.innerHTML = `
      <div id="item">
        <label>名称<input class="dup" /></label>
        <label>名称<input class="dup" /></label>
        <label>说明<input name="note" /></label>
      </div>`;
    const container = document.getElementById('item') as HTMLElement;
    const items = distillScopedElements(container, { sectionType: 'project', instanceId: 'instance_01' });
    const duplicated = items.filter((item) => item.field.descriptor.normalizedLabel === '名称');
    expect(duplicated).toHaveLength(2);
    expect(duplicated[0]?.field.descriptor.disambiguator?.sameLabelSiblingIndex).toBe(0);
    expect(duplicated[1]?.field.descriptor.disambiguator?.sameLabelSiblingIndex).toBe(1);
    const note = items.find((item) => item.field.descriptor.normalizedLabel === '说明');
    expect(note?.field.descriptor.disambiguator?.sameLabelSiblingIndex).toBeUndefined();
  });

  it('带稳定 name 的同名字段不启用序号回退', () => {
    document.body.innerHTML = `
      <div id="item">
        <label>名称<input name="firstName" /></label>
        <label>名称<input name="lastName" /></label>
      </div>`;
    const container = document.getElementById('item') as HTMLElement;
    const items = distillScopedElements(container, { sectionType: 'basic', instanceId: 'instance_01' });
    expect(items.every((item) => item.field.descriptor.disambiguator?.sameLabelSiblingIndex === undefined)).toBe(true);
  });
});

describe('readFieldValueText', () => {
  it('读取文本框与下拉框文本', () => {
    document.body.innerHTML = `
      <input id="text" value="hello" />
      <select id="select">
        <option>大专</option>
        <option selected>本科</option>
      </select>`;
    expect(readFieldValueText(document.getElementById('text') as HTMLElement)).toBe('hello');
    expect(readFieldValueText(document.getElementById('select') as HTMLElement)).toBe('本科');
  });

  it('读取选中单选项与复选框', () => {
    document.body.innerHTML = `
      <label><input type="radio" name="gender" value="男" checked /> 男</label>
      <label><input type="radio" name="gender" value="女" /> 女</label>
      <input id="agree" type="checkbox" checked />`;
    const male = document.querySelector('input[value="男"]') as HTMLElement;
    expect(readFieldValueText(male)).toBe('男');
    expect(readFieldValueText(document.getElementById('agree') as HTMLElement)).toBe('true');
  });

  it('未选中单选框返回空串', () => {
    document.body.innerHTML = `
      <label><input type="radio" name="gender" value="男" /> 男</label>
      <label><input type="radio" name="gender" value="女" /> 女</label>`;
    const male = document.querySelector('input[value="男"]') as HTMLElement;
    expect(readFieldValueText(male)).toBe('');
  });
});

describe('readStableAttribute', () => {
  it('按优先级读取稳定标识属性', () => {
    document.body.innerHTML = `
      <input id="with" data-field-id="fld-1" />
      <input id="without" />`;
    expect(readStableAttribute(document.getElementById('with') as HTMLElement)).toBe('fld-1');
    expect(readStableAttribute(document.getElementById('without') as HTMLElement)).toBeUndefined();
  });
});
