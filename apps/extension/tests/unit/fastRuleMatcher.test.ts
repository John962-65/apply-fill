import { describe, expect, it } from 'vitest';

import { matchRule, normalizeForMatch } from '@/router/FastRuleMatcher';

describe('FastRuleMatcher', () => {
  it('精确标签命中基础规则', () => {
    expect(matchRule('text', '姓名')?.targetPath).toBe('basic.name');
    expect(matchRule('tel', '手机号码')?.targetPath).toBe('basic.phone');
    expect(matchRule('email', '邮箱')?.targetPath).toBe('basic.email');
  });

  it('剥离前置提示词后再匹配', () => {
    expect(matchRule('text', '请输入姓名')?.targetPath).toBe('basic.name');
    expect(matchRule('text', '请填写联系电话')?.targetPath).toBe('basic.phone');
  });

  it('剥离括号补充说明后再匹配', () => {
    expect(matchRule('number', '期望薪资（千元）')?.targetPath).toBe('preferences.expectedSalary');
  });

  it('控件类型不符时不匹配', () => {
    expect(matchRule('text', '性别')).toBeUndefined();
    expect(matchRule('radio', '性别')?.targetPath).toBe('basic.gender');
    expect(matchRule('text', '接收通知')).toBeUndefined();
    expect(matchRule('checkbox', '接收通知')?.targetPath).toBe('preferences.subscribeNotifications');
  });

  it('教育字段命中索引占位路径', () => {
    expect(matchRule('text', '毕业院校')?.targetPath).toBe('education[{index}].school');
    expect(matchRule('select', '最高学历')?.targetPath).toBe('education[{index}].degree');
  });

  it('项目字段命中索引占位路径', () => {
    expect(matchRule('text', '项目名称')?.targetPath).toBe('projects[{index}].name');
    expect(matchRule('text', '担任角色')?.targetPath).toBe('projects[{index}].role');
    expect(matchRule('textarea', '项目描述')?.targetPath).toBe('projects[{index}].description');
  });

  it('未知标签返回 undefined', () => {
    expect(matchRule('text', '验证码')).toBeUndefined();
    expect(matchRule('text', '昵称')).toBeUndefined();
  });

  it('normalizeForMatch 处理提示词和标点', () => {
    expect(normalizeForMatch('请输入姓名 *')).toBe('姓名');
    expect(normalizeForMatch('  期望月薪（税前） ')).toBe('期望月薪');
  });
});
