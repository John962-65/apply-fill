import { describe, expect, it } from 'vitest';

import { distillElements, distillField } from '@/perceptor/FieldDistiller';
import { detectSectionType, scanFormElements } from '@/perceptor/FormScanner';

import { mustFind, mustQuery } from './helpers';

describe('FormScanner', () => {
  it('跳过隐藏/文件/按钮类输入与插件 UI', () => {
    document.body.innerHTML = `
      <form>
        <input type="hidden" name="hidden" />
        <input type="file" name="file" />
        <input type="submit" />
        <input type="text" id="visible" />
        <input type="text" id="ghost" style="display: none" />
        <div data-applyfill-ui><input type="text" id="plugin" /></div>
      </form>`;
    const found = scanFormElements(document);
    const ids = found.map((element) => element.id);
    expect(ids).toEqual(['visible']);
  });

  it('跳过密码与验证码类敏感输入', () => {
    document.body.innerHTML = `
      <form>
        <input type="password" id="password" name="password" />
        <input type="text" id="sms" placeholder="短信验证码" />
        <input type="tel" id="otp" name="otp" />
        <label for="code">图形验证码</label><input type="text" id="code" />
        <input type="text" id="autocomplete-otp" autocomplete="one-time-code" />
        <input type="text" id="normal" name="city" />
        <input type="checkbox" id="sms-notify" name="smsNotify" />
      </form>`;
    const found = scanFormElements(document);
    const ids = found.map((element) => element.id);
    expect(ids).toEqual(['normal', 'sms-notify']);
  });

  it('根据祖先标题推断区块类型', () => {
    document.body.innerHTML = `
      <section>
        <h2>教育经历</h2>
        <div><input id="school" /></div>
      </section>`;
    expect(detectSectionType(mustQuery('#school'))).toBe('education');
  });

  it('fieldset legend 推断区块类型', () => {
    document.body.innerHTML = '<fieldset><legend>项目经历</legend><input id="p" /></fieldset>';
    expect(detectSectionType(mustQuery('#p'))).toBe('project');
  });

  it('无标题时默认为 basic 区块', () => {
    document.body.innerHTML = '<form><input id="plain" /></form>';
    expect(detectSectionType(mustQuery('#plain'))).toBe('basic');
  });
});

describe('FieldDistiller', () => {
  it('label-for 提供标签与来源', () => {
    document.body.innerHTML = '<label for="name">姓名</label><input id="name" name="fullName" required />';
    const field = distillField(mustQuery('#name'));
    expect(field?.label).toBe('姓名');
    expect(field?.labelSource).toBe('label-for');
    expect(field?.controlKind).toBe('text');
    expect(field?.required).toBe(true);
    expect(field?.descriptor.disambiguator?.fieldName).toBe('fullName');
  });

  it('placeholder 作为后备标签', () => {
    document.body.innerHTML = '<input id="email" placeholder="请输入邮箱" />';
    const field = distillField(mustQuery('#email'));
    expect(field?.label).toBe('请输入邮箱');
    expect(field?.labelSource).toBe('placeholder');
  });

  it('aria-label 优先于 name', () => {
    document.body.innerHTML = '<input name="phone" aria-label="手机号码" />';
    const field = distillField(mustQuery('input'));
    expect(field?.label).toBe('手机号码');
    expect(field?.labelSource).toBe('aria-label');
  });

  it('单选组读取 fieldset legend 与选项文本', () => {
    document.body.innerHTML = `
      <fieldset>
        <legend>性别</legend>
        <label><input type="radio" name="gender" value="male" /> 男</label>
        <label><input type="radio" name="gender" value="female" /> 女</label>
      </fieldset>`;
    const first = mustQuery<HTMLInputElement>('input[type="radio"]');
    const field = distillField(first);
    expect(field?.label).toBe('性别');
    expect(field?.controlKind).toBe('radio');
    expect(field?.options).toEqual(['男', '女']);
    expect(field?.descriptor.disambiguator?.groupLabel).toBe('gender');
  });

  it('distillElements 去重同一单选组', () => {
    document.body.innerHTML = `
      <fieldset>
        <legend>性别</legend>
        <label><input type="radio" name="gender" value="male" /> 男</label>
        <label><input type="radio" name="gender" value="female" /> 女</label>
      </fieldset>`;
    const elements = scanFormElements(document);
    const distilled = distillElements(elements);
    expect(distilled).toHaveLength(1);
    expect(distilled[0]?.field.options).toEqual(['男', '女']);
  });

  it('收集下拉选项与 constraints', () => {
    document.body.innerHTML = `
      <label for="intro">个人简介</label>
      <textarea id="intro" maxlength="20"></textarea>
      <select id="degree">
        <option value="">请选择</option>
        <option>本科</option>
      </select>`;
    const textarea = distillField(mustQuery('#intro'));
    expect(textarea?.controlKind).toBe('textarea');
    expect(textarea?.constraints?.maxLength).toBe(20);

    const select = distillField(mustQuery('#degree'));
    expect(select?.controlKind).toBe('select');
    expect(select?.options).toEqual(['请选择', '本科']);
  });

  it('无法识别的控件返回 undefined', () => {
    document.body.innerHTML = '<div id="plain"></div>';
    expect(distillField(mustQuery('#plain'))).toBeUndefined();
  });

  it('禁用与只读状态被记录', () => {
    document.body.innerHTML = '<input id="locked" disabled /><input id="ro" readonly />';
    expect(distillField(mustQuery('#locked'))?.disabled).toBe(true);
    expect(distillField(mustQuery('#ro'))?.readonly).toBe(true);
    const items = distillElements(scanFormElements(document));
    expect(mustFind(items, (item) => item.element.id === 'locked').field.disabled).toBe(true);
  });
});
