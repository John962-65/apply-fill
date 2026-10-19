import { delay } from '@/shared/utils/timing';

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
  const field = input.closest('[data-upload], .ant-upload-wrapper, .el-upload, [role="group"]');
  if (field !== null) return field;
  let node: Element = input.parentElement ?? input;
  for (let depth = 0; depth < ACK_SCOPE_DEPTH; depth += 1) {
    const parent = node.parentElement;
    if (node.tagName === 'FORM' || parent === null || parent.tagName === 'BODY' || parent.tagName === 'HTML') {
      break;
    }
    node = parent;
  }
  return node;
}

function acknowledgementNodes(scope: Element, fileName: string): Element[] {
  return [scope, ...scope.querySelectorAll('*')].filter(
    (node) => node.textContent?.includes(fileName) === true &&
      ![...node.children].some((child) => child.textContent?.includes(fileName) === true),
  );
}

export class FileUploadAgent {
  async upload(input: HTMLInputElement, file: File, options: UploadOptions = {}): Promise<UploadResult> {
    const isAborted = (): boolean => options.signal?.aborted === true;
    const aborted = (): UploadResult => ({ outcome: 'REJECTED', message: '上传被取消', detail: 'ABORTED' });
    if (isAborted()) return aborted();
    if (input.disabled) {
      return { outcome: 'REJECTED', message: '上传控件处于禁用状态', detail: 'INPUT_DISABLED' };
    }
    if (!input.isConnected) return { outcome: 'REJECTED', message: '上传控件已失效', detail: 'INPUT_DETACHED' };
    const files = buildFileList(file);
    if (files === null) {
      return { outcome: 'REJECTED', message: '当前环境不支持 DataTransfer 文件注入', detail: 'DATA_TRANSFER_UNAVAILABLE' };
    }
    const scope = scopeOf(input);
    const previousAcknowledgements = new Map(
      acknowledgementNodes(scope, file.name).map((node) => [node, node.textContent]),
    );
    try {
      if (isAborted()) return aborted();
      input.files = files;
    } catch {
      return { outcome: 'REJECTED', message: '无法写入文件列表', detail: 'FILES_ASSIGN_FAILED' };
    }
    if (input.files?.length !== 1 || input.files[0]?.name !== file.name) {
      return { outcome: 'REJECTED', message: '文件列表写入后校验失败', detail: 'FILES_VERIFY_FAILED' };
    }
    if (isAborted()) return aborted();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (isAborted()) return aborted();
    if (!input.isConnected) return { outcome: 'REJECTED', message: '上传控件已失效', detail: 'INPUT_DETACHED' };
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const ackTimeoutMs = options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const deadline = Date.now() + ackTimeoutMs;
    while (Date.now() < deadline) {
      if (!input.isConnected) return { outcome: 'REJECTED', message: '上传控件已失效', detail: 'INPUT_DETACHED' };
      if (isAborted()) {
        return aborted();
      }
      const currentCount: number = input.files?.length ?? 0;
      if (currentCount === 0) {
        return { outcome: 'REJECTED', message: '网站拒绝了程序化文件注入', detail: 'SITE_CLEARED_FILES' };
      }
      const currentFile = input.files?.[0];
      if (currentFile?.name !== file.name || currentFile.size !== file.size || currentFile.type !== file.type) {
        return { outcome: 'REJECTED', message: '文件已被重新选择，请核对上传结果', detail: 'FILE_REPLACED' };
      }
      if (acknowledgementNodes(scope, file.name).some(
        (node) => !previousAcknowledgements.has(node) || previousAcknowledgements.get(node) !== node.textContent,
      )) {
        return { outcome: 'SITE_CONFIRMED', message: `网站已接收文件：${file.name}` };
      }
      try { await delay(pollIntervalMs, options.signal); }
      catch { return aborted(); }
    }
    return {
      outcome: 'INJECTED_UNCONFIRMED',
      message: '文件已注入输入框，但未检测到网站自身的接收确认',
      detail: 'SITE_ACK_TIMEOUT',
    };
  }
}
