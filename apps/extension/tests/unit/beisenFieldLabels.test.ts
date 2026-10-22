import { describe, expect, it } from 'vitest';
import { computeFieldKey } from '@/identity/DeterministicFieldKey';
import { distillElements, distillField, distillScopedElements } from '@/perceptor/FieldDistiller';
import { detectSectionType, scanFormElements } from '@/perceptor/FormScanner';
import { scanRepeatableSections } from '@/perceptor/SectionScanner';
import { FingerprintCache, fingerprintInputFor } from '@/router/FingerprintCache';
import type { FieldSignature } from '@/shared/contracts/field';
import { mustQuery } from './helpers';

function row(title: string, control: string, extra = ''): string {
  return `<div class="fields-col"><div class="form-item form-item--phoenix"><div class="form-item__title">
    <a class="form-item__required"><svg><title>必填</title></svg></a><span><label class="form-item__text">${title}</label></span>
    <i class="icon-cus-bangzhu" title="提示文字"></i></div><div class="form-item__control">${control}${extra}</div></div></div>`;
}

describe('unassociated recruitment form labels', () => {
  it('北森标题优先于通用占位符，不读取当前值、帮助文案和错误信息', () => {
    document.body.innerHTML = row('姓名', '<div><input id="name" placeholder="请输入" value="私人姓名" /></div>', '<span class="form-item__error">请输入姓名</span>') +
      row('邮箱', '<div><input id="email" placeholder="请输入" /></div>');
    const fields = distillElements(scanFormElements(document));
    expect(fields.map(({ field }) => [field.label, field.labelSource, field.required])).toEqual([
      ['姓名', 'nearby-label', true], ['邮箱', 'nearby-label', true],
    ]);
    expect(new Set(fields.map(({ field }) => computeFieldKey(field.descriptor))).size).toBe(2);
    mustQuery<HTMLInputElement>('#name').value = '另一个姓名';
    expect(distillField(mustQuery('#name'))?.descriptor).toEqual(fields[0]!.field.descriptor);
  });

  it('显式 label 和 ARIA 仍优先，相邻字段的标题不会被借用', () => {
    document.body.innerHTML = row('旧标题', '<input id="explicit" aria-label="电子邮箱" placeholder="请输入" />') +
      '<div><label>姓名</label><div><input id="nearby" placeholder="请输入" /></div><input id="unlabelled" placeholder="请输入" /></div>';
    expect(distillField(mustQuery('#explicit'))?.label).toBe('电子邮箱');
    expect(distillField(mustQuery('#nearby'))?.label).toBe('姓名');
    expect(distillField(mustQuery('#unlabelled'))?.label).toBe('请输入');
  });

  it('不使用指向其他控件的标签或隐藏标题', () => {
    document.body.innerHTML = '<div><label for="other">手机号</label><input id="plain" placeholder="请输入" /></div>' +
      row('隐藏标题', '<input id="hidden-title" placeholder="请输入" />') + row('别的控件', '<input id="wrong-target" placeholder="请输入" />');
    mustQuery('.form-item__title').setAttribute('hidden', '');
    mustQuery('#wrong-target').closest('.form-item')!.querySelector('label')!.setAttribute('for', 'other');
    expect(distillField(mustQuery('#plain'))?.label).toBe('请输入');
    expect(distillField(mustQuery('#hidden-title'))?.label).toBe('请输入');
    expect(distillField(mustQuery('#wrong-target'))?.label).toBe('请输入');
  });

  it('相同占位符、相同 name 和相同组标题不会使不同控件覆盖彼此，包括无标签控件', () => {
    document.body.innerHTML = '<section><h2>个人信息</h2><input placeholder="请输入" /><input placeholder="请输入" />' +
      '<input name="shared" placeholder="请选择" /><input name="shared" placeholder="请选择" /><input /><input /></section>';
    const fields = distillElements(scanFormElements(document));
    expect(fields).toHaveLength(6);
    expect(new Set(fields.map(({ field }) => computeFieldKey(field.descriptor))).size).toBe(6);
    expect(fields.map(({ field }) => field.descriptor.disambiguator?.sameLabelSiblingIndex)).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it('对一个同名字段的缓存修正不能自动应用到另一个同名字段', () => {
    document.body.innerHTML = '<input placeholder="请输入" /><input placeholder="请输入" />';
    const fields = distillElements(scanFormElements(document));
    const signatures = fields.map(({ field }) => ({ ...field, fieldKey: computeFieldKey(field.descriptor) } as FieldSignature));
    const cache = new FingerprintCache();
    cache.record(fingerprintInputFor('jobs.test', signatures[0]!), 'basic.name');
    expect(cache.get(fingerprintInputFor('jobs.test', signatures[0]!))?.targetPathTemplate).toBe('basic.name');
    expect(cache.get(fingerprintInputFor('jobs.test', signatures[1]!))).toBeUndefined();
  });

  it('无 name 的原生单选项以同一个字段容器分组，不将男/女当字段名', () => {
    document.body.innerHTML = row('性别', '<div class="phoenix-radio-group"><label><input type="radio" value="M" />男</label><label><input type="radio" value="F" />女</label></div>') +
      row('是否应届', '<div class="phoenix-radio-group"><label><input type="radio" value="Y" />是</label><label><input type="radio" value="N" />否</label></div>');
    const fields = distillElements(scanFormElements(document));
    expect(fields.map(({ field }) => [field.label, field.options])).toEqual([['性别', ['男', '女']], ['是否应届', ['是', '否']]]);
  });

  it('识别 form-part 标题，个人信息不会被归入上传或教育区块', () => {
    document.body.innerHTML = '<div class="ux-standard-form">' +
      '<div class="form-part"><div class="form-part-head"><span class="head-title">上传简历</span></div><input type="file" /></div>' +
      '<div class="form-part"><div class="form-part-head"><span class="head-title">个人信息</span></div><div>' + row('姓名', '<input id="name" placeholder="请输入" />') + '</div></div>' +
      '<div class="form-part" id="education"><div class="form-part-head"><span class="head-title">教育经历</span></div><div>' + row('学校名称', '<input id="school" placeholder="请输入" />') + '</div></div></div>';
    expect(detectSectionType(mustQuery('#name'))).toBe('basic');
    expect(detectSectionType(mustQuery('#school'))).toBe('education');
    const sections = scanRepeatableSections(document);
    expect(sections.find((section) => section.sectionType === 'education')?.scope.id).toBe('education');
  });

  it('通过相邻标题识别的验证码依然不参与填写', () => {
    document.body.innerHTML = row('短信验证码', '<input id="otp" placeholder="请输入" />') + row('手机号码', '<input id="phone" placeholder="请输入" />');
    expect(scanFormElements(document).map((element) => element.id)).toEqual(['phone']);
    expect(distillScopedElements(document.body, { sectionType: 'education', instanceId: 'education-1' })
      .map(({ element }) => element.id)).toEqual(['phone']);
  });
});
