import { describe, expect, it } from 'vitest';

import {
  findRadioByText,
  findSelectOption,
  selectRadioByText,
  setChecked,
  setSelectValue,
  setTextValue,
} from '@/actuator/Primitives';

import { mustQuery, queryAll } from './helpers';

describe('Actuator Primitives', () => {
  it('setTextValue 设置值并派发 input/change 事件', async () => {
    document.body.innerHTML = '<input id="name" />';
    const input = mustQuery<HTMLInputElement>('#name');
    const events: string[] = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));

    await setTextValue(input, '张三');

    expect(input.value).toBe('张三');
    expect(events).toEqual(['input', 'change']);
  });

  it('setTextValue 对 textarea 同样生效', async () => {
    document.body.innerHTML = '<textarea id="intro"></textarea>';
    const textarea = mustQuery<HTMLTextAreaElement>('#intro');
    await setTextValue(textarea, '个人简介');
    expect(textarea.value).toBe('个人简介');
  });

  it('setTextValue 尊重已中止的信号', async () => {
    document.body.innerHTML = '<input id="name" />';
    const input = mustQuery<HTMLInputElement>('#name');
    const controller = new AbortController();
    controller.abort();
    await expect(setTextValue(input, '张三', controller.signal)).rejects.toThrowError(/aborted/);
    expect(input.value).toBe('');
  });

  it('setSelectValue 按选项文本精确匹配', async () => {
    document.body.innerHTML =
      '<select id="degree"><option value="">请选择</option><option value="bachelor">本科</option></select>';
    const select = mustQuery<HTMLSelectElement>('#degree');

    await setSelectValue(select, '本科');

    expect(select.value).toBe('bachelor');
    expect(select.selectedOptions[0]?.textContent).toBe('本科');
  });

  it('setSelectValue 无匹配选项时抛出 ACTUATOR_ERROR', async () => {
    document.body.innerHTML = '<select id="degree"><option>大专</option></select>';
    const select = mustQuery<HTMLSelectElement>('#degree');
    await expect(setSelectValue(select, '博士')).rejects.toThrowError(/no select option/);
  });

  it('findSelectOption 支持包含式宽松匹配', () => {
    document.body.innerHTML = '<select id="degree"><option>大学本科</option></select>';
    const select = mustQuery<HTMLSelectElement>('#degree');
    expect(findSelectOption(select, '本科')?.textContent).toBe('大学本科');
  });

  it('setChecked 勾选与取消勾选复选框', async () => {
    document.body.innerHTML = '<input id="fresh" type="checkbox" />';
    const checkbox = mustQuery<HTMLInputElement>('#fresh');

    await setChecked(checkbox, true);
    expect(checkbox.checked).toBe(true);

    await setChecked(checkbox, false);
    expect(checkbox.checked).toBe(false);
  });

  it('setChecked 状态已一致时不产生点击', async () => {
    document.body.innerHTML = '<input id="fresh" type="checkbox" checked />';
    const checkbox = mustQuery<HTMLInputElement>('#fresh');
    let clicks = 0;
    checkbox.addEventListener('click', () => {
      clicks += 1;
    });

    await setChecked(checkbox, true);

    expect(clicks).toBe(0);
    expect(checkbox.checked).toBe(true);
  });

  it('selectRadioByText 按选项文本选中分组中的单选', async () => {
    document.body.innerHTML = `
      <form>
        <fieldset>
          <legend>性别</legend>
          <label><input type="radio" name="gender" value="male" /> 男</label>
          <label><input type="radio" name="gender" value="female" /> 女</label>
        </fieldset>
      </form>`;
    const first = mustQuery<HTMLInputElement>('input[value="male"]');

    await selectRadioByText(first, '女');

    const radios = queryAll<HTMLInputElement>('input[type="radio"]');
    expect(radios.find((radio) => radio.value === 'female')?.checked).toBe(true);
    expect(radios.find((radio) => radio.value === 'male')?.checked).toBe(false);
  });

  it('findRadioByText 无匹配时返回 undefined', () => {
    document.body.innerHTML = '<label><input type="radio" name="g" value="1" /> 是</label>';
    const radio = mustQuery<HTMLInputElement>('input');
    expect(findRadioByText([radio], '不确定')).toBeUndefined();
  });
});
