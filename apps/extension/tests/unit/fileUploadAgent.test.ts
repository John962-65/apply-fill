import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileUploadAgent } from '@/actuator/FileUploadAgent';

class FakeDataTransfer {
  private readonly list: File[] = [];

  readonly items = {
    add: (file: File): void => {
      this.list.push(file);
    },
  };

  get files(): FileList {
    return this.list as unknown as FileList;
  }
}

function makeInput(): HTMLInputElement {
  document.body.innerHTML = `<form id="upload-form"><input id="u" type="file"></form>`;
  const input = document.querySelector('#u') as HTMLInputElement;
  const transfer = new FakeDataTransfer();
  Object.defineProperty(input, 'files', {
    value: transfer.files,
    writable: true,
    configurable: true,
  });
  return input;
}

function makeFile(name = 'resume.pdf', type = 'application/pdf'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe('FileUploadAgent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('网站显示文件名时判定 SITE_CONFIRMED', async () => {
    vi.stubGlobal('DataTransfer', FakeDataTransfer);
    const input = makeInput();
    input.addEventListener('change', () => {
      const form = document.querySelector('#upload-form') as HTMLElement;
      const status = document.createElement('div');
      const file = input.files?.[0];
      status.textContent = `已选择：${file?.name ?? ''}`;
      form.appendChild(status);
    });
    const agent = new FileUploadAgent();
    const result = await agent.upload(input, makeFile(), { ackTimeoutMs: 300 });
    expect(result.outcome).toBe('SITE_CONFIRMED');
    expect(input.files?.length).toBe(1);
  });

  it('网站清空文件列表时判定 REJECTED', async () => {
    vi.stubGlobal('DataTransfer', FakeDataTransfer);
    const input = makeInput();
    input.addEventListener('change', () => {
      input.files = [] as unknown as FileList;
    });
    const agent = new FileUploadAgent();
    const result = await agent.upload(input, makeFile(), { ackTimeoutMs: 300 });
    expect(result.outcome).toBe('REJECTED');
    expect(result.detail).toBe('SITE_CLEARED_FILES');
  });

  it('注入成功但网站无确认时判定 INJECTED_UNCONFIRMED（转人工）', async () => {
    vi.stubGlobal('DataTransfer', FakeDataTransfer);
    const input = makeInput();
    const agent = new FileUploadAgent();
    const result = await agent.upload(input, makeFile(), { ackTimeoutMs: 120, pollIntervalMs: 20 });
    expect(result.outcome).toBe('INJECTED_UNCONFIRMED');
    expect(input.files?.length).toBe(1);
  });

  it('中止信号与禁用控件直接拒绝', async () => {
    vi.stubGlobal('DataTransfer', FakeDataTransfer);
    const input = makeInput();
    const controller = new AbortController();
    controller.abort();
    const agent = new FileUploadAgent();
    const aborted = await agent.upload(input, makeFile(), { signal: controller.signal, ackTimeoutMs: 300 });
    expect(aborted.detail).toBe('ABORTED');

    const disabled = makeInput();
    disabled.disabled = true;
    const blocked = await agent.upload(disabled, makeFile(), { ackTimeoutMs: 100 });
    expect(blocked.detail).toBe('INPUT_DISABLED');
  });

  it('缺少 DataTransfer 支持时返回 DATA_TRANSFER_UNAVAILABLE', async () => {
    vi.stubGlobal('DataTransfer', undefined);
    const input = makeInput();
    const agent = new FileUploadAgent();
    const result = await agent.upload(input, makeFile(), { ackTimeoutMs: 100 });
    expect(result.outcome).toBe('REJECTED');
    expect(result.detail).toBe('DATA_TRANSFER_UNAVAILABLE');
  });
});
