import { beforeEach, describe, expect, it, vi } from 'vitest';

import { detectValidationError } from '@/verifier/ValidationErrorDetector';

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(
    function getClientRects(this: Element) {
      if (this.getAttribute('data-hidden') === 'true') {
        return { length: 0 } as unknown as DOMRectList;
      }
      return { length: 1 } as unknown as DOMRectList;
    },
  );
});

describe('detectValidationError', () => {
  it('aria-invalid 指向 aria-errormessage 错误文本', () => {
    document.body.innerHTML = `
      <div class="form-item">
        <input id="email" aria-invalid="true" aria-errormessage="email-error" />
        <span id="email-error">必须使用企业邮箱</span>
      </div>
    `;
    const input = document.getElementById('email') as HTMLElement;
    expect(detectValidationError(input)).toEqual({ hasError: true, message: '必须使用企业邮箱' });
  });

  it('aria-invalid 且无引用时读取同容器错误节点文本', () => {
    document.body.innerHTML = `
      <div class="form-item">
        <input id="phone" aria-invalid="true" />
        <span class="error">手机号格式不正确</span>
      </div>
    `;
    const input = document.getElementById('phone') as HTMLElement;
    expect(detectValidationError(input)).toEqual({ hasError: true, message: '手机号格式不正确' });
  });

  it('aria-invalid 无错误文本时回退占位消息', () => {
    document.body.innerHTML = `
      <div class="form-item">
        <input id="code" aria-invalid="true" />
      </div>
    `;
    const input = document.getElementById('code') as HTMLElement;
    expect(detectValidationError(input)).toEqual({ hasError: true, message: 'aria-invalid' });
  });

  it('原生约束失败时读取 validationMessage', () => {
    document.body.innerHTML = `
      <div class="form-item">
        <input id="mail" type="email" value="not-an-email" />
      </div>
    `;
    const input = document.getElementById('mail') as HTMLInputElement;
    if (input.validity.valid) {
      return;
    }
    const info = detectValidationError(input);
    expect(info.hasError).toBe(true);
    expect(info.message.length).toBeGreaterThan(0);
  });

  it('aria-describedby 引用错误节点也可识别', () => {
    document.body.innerHTML = `
      <div class="form-item">
        <input id="desc" aria-describedby="desc-error" />
        <span id="desc-error" class="error">请选择有效的城市</span>
      </div>
    `;
    const input = document.getElementById('desc') as HTMLElement;
    expect(detectValidationError(input)).toEqual({ hasError: true, message: '请选择有效的城市' });
  });

  it('其他容器的错误节点不误报', () => {
    document.body.innerHTML = `
      <div class="form-item">
        <input id="ok" />
      </div>
      <div class="form-item">
        <input id="other" aria-invalid="true" />
        <span class="error">另一字段的错误</span>
      </div>
    `;
    const input = document.getElementById('ok') as HTMLElement;
    expect(detectValidationError(input)).toEqual({ hasError: false, message: '' });
  });

  it('隐藏的错误节点不触发', () => {
    document.body.innerHTML = `
      <div class="form-item">
        <input id="hidden-case" aria-invalid="true" />
        <span class="error" data-hidden="true">不可见的错误</span>
      </div>
    `;
    const input = document.getElementById('hidden-case') as HTMLElement;
    expect(detectValidationError(input)).toEqual({ hasError: true, message: 'aria-invalid' });
  });

  it('字段正常时无错误', () => {
    document.body.innerHTML = `
      <div class="form-item">
        <input id="fine" value="北京市" />
        <span class="hint">请输入所在城市</span>
      </div>
    `;
    const input = document.getElementById('fine') as HTMLElement;
    expect(detectValidationError(input)).toEqual({ hasError: false, message: '' });
  });
});
