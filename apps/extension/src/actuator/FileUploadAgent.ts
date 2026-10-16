export type UploadOutcome = 'SITE_CONFIRMED' | 'INJECTED_UNCONFIRMED' | 'REJECTED';

export interface UploadResult {
  outcome: UploadOutcome;
  message: string;
  detail?: string;
}

export interface UploadOptions {
  signal?: AbortSignal;
  ackTimeoutMs?: number;
  pollIntervalMs?: number;
}

const DEFAULT_ACK_TIMEOUT_MS = 1000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const ACK_SCOPE_DEPTH = 4;

function buildFileList(file: File): FileList | null {
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    return transfer.files;
  } catch {
    return null;
  }
}

function scopeOf(input: HTMLInputElement): Element {
  let node: Element = input.closest('form') ?? input.parentElement ?? input;
  for (let depth = 0; depth < ACK_SCOPE_DEPTH; depth += 1) {
    const parent = node.parentElement;
    if (parent === null || parent.tagName === 'BODY' || parent.tagName === 'HTML') {
      break;
    }
    node = parent;
  }
  return node;
}

function siteAcknowledges(input: HTMLInputElement, fileName: string): boolean {
  return scopeOf(input).textContent?.includes(fileName) === true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FileUploadAgent {
  async upload(input: HTMLInputElement, file: File, options: UploadOptions = {}): Promise<UploadResult> {
    if (input.disabled) {
      return { outcome: 'REJECTED', message: '上传控件处于禁用状态', detail: 'INPUT_DISABLED' };
    }
    const files = buildFileList(file);
    if (files === null) {
      return { outcome: 'REJECTED', message: '当前环境不支持 DataTransfer 文件注入', detail: 'DATA_TRANSFER_UNAVAILABLE' };
    }
    try {
      input.files = files;
    } catch {
      return { outcome: 'REJECTED', message: '无法写入文件列表', detail: 'FILES_ASSIGN_FAILED' };
    }
    if (input.files?.length !== 1 || input.files[0]?.name !== file.name) {
      return { outcome: 'REJECTED', message: '文件列表写入后校验失败', detail: 'FILES_VERIFY_FAILED' };
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const ackTimeoutMs = options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const deadline = Date.now() + ackTimeoutMs;
    while (Date.now() < deadline) {
      if (options.signal?.aborted === true) {
        return { outcome: 'REJECTED', message: '上传被取消', detail: 'ABORTED' };
      }
      const currentCount: number = input.files?.length ?? 0;
      if (currentCount === 0) {
        return { outcome: 'REJECTED', message: '网站拒绝了程序化文件注入', detail: 'SITE_CLEARED_FILES' };
      }
      if (siteAcknowledges(input, file.name)) {
        return { outcome: 'SITE_CONFIRMED', message: `网站已接收文件：${file.name}` };
      }
      await delay(pollIntervalMs);
    }
    return {
      outcome: 'INJECTED_UNCONFIRMED',
      message: '文件已注入输入框，但未检测到网站自身的接收确认',
      detail: 'SITE_ACK_TIMEOUT',
    };
  }
}
