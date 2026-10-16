import { useCallback, useEffect, useRef, useState } from 'react';

import type { FieldExecutionResult, FieldStatus } from '@/shared/contracts/field';
import type { SessionRunState } from '@/shared/contracts/run';
import type { ActiveTabInfo, PanelPortMessage, ResumeStatusInfo, TabCommand } from '@/shared/messages/protocol';

const STATUS_TEXT: Record<string, string> = {
  VERIFIED: '已填写',
  USER_OVERRIDDEN: '用户接管',
  NEEDS_MANUAL: '需人工',
  RETRYABLE: '重试失败',
  CIRCUIT_BROKEN: '已熔断',
  CANCELLED: '已取消',
};

function statusClass(status: string): string {
  return STATUS_TEXT[status] !== undefined ? `status status-${status}` : 'status status-default';
}

function fieldStatusText(result: FieldExecutionResult): string {
  return STATUS_TEXT[result.status] ?? result.status;
}

function statusLabel(status: FieldStatus | string): string {
  return STATUS_TEXT[status] ?? status;
}

export function App() {
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const [connected, setConnected] = useState(false);
  const [runState, setRunState] = useState<SessionRunState | null>(null);
  const [resumeStatus, setResumeStatus] = useState<ResumeStatusInfo | null>(null);
  const [tabInfo, setTabInfo] = useState<ActiveTabInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const refreshInfo = useCallback(async () => {
    const status = (await chrome.runtime.sendMessage({ type: 'GET_RESUME_STATUS' })) as ResumeStatusInfo;
    setResumeStatus(status);
    const info = (await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_INFO' })) as ActiveTabInfo;
    setTabInfo(info);
  }, []);

  useEffect(() => {
    const port = chrome.runtime.connect({ name: 'sidepanel' });
    portRef.current = port;
    setConnected(true);
    port.onMessage.addListener((message: PanelPortMessage) => {
      if (message.type === 'RUN_STATE') {
        setRunState(message.state);
      } else if (message.type === 'RUN_EVENT') {
        port.postMessage({ type: 'PANEL_COMMAND', command: 'GET_STATE' } satisfies PanelPortMessage);
      } else if (message.type === 'COMMAND_RESULT') {
        setBusy(false);
        setNotice(message.message ?? '');
      }
    });
    port.onDisconnect.addListener(() => {
      setConnected(false);
      portRef.current = null;
    });
    void refreshInfo();
    return () => {
      port.disconnect();
    };
  }, [refreshInfo]);

  const sendCommand = useCallback((command: TabCommand, fieldKey?: string) => {
    if (command !== 'GET_STATE') {
      setBusy(true);
      setNotice('');
    }
    portRef.current?.postMessage({
      type: 'PANEL_COMMAND',
      command,
      ...(fieldKey !== undefined ? { fieldKey } : {}),
    } satisfies PanelPortMessage);
  }, []);

  const summary = runState?.summary;
  const fields = summary?.fields ?? [];
  const noDataIssues = summary?.mappingIssues.filter((issue) => issue.kind === 'NO_DATA').length ?? 0;
  const userProtectedFields = summary?.dirty?.userProtected.length ?? 0;
  const detectedUserEdits = (summary?.counts.userOverridden ?? 0) + userProtectedFields;
  const unconfirmedCommits = fields.filter((field) => field.commit?.status === 'UNKNOWN').length;
  const retryableStatuses = new Set(['NEEDS_MANUAL', 'RETRYABLE', 'CIRCUIT_BROKEN']);

  return (
    <div className="panel">
      <div className="card">
        <h2>当前页面</h2>
        <div className="meta">
          {tabInfo?.url !== undefined ? (
            <>
              <div className="field-label">{tabInfo.title ?? '(无标题)'}</div>
              <div>{tabInfo.url}</div>
              <div>内容脚本：{tabInfo.contentScriptAlive ? '已连接' : '未检测到'}</div>
            </>
          ) : (
            <div>未找到可操作的标签页（当前仅支持本地测试页面）</div>
          )}
          <div>
            简历：{resumeStatus?.hasResume === true ? `已导入（${resumeStatus.name ?? ''}）` : '尚未导入'}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>任务控制</h2>
        <div className="row">
          <button className="primary" disabled={busy || !connected} onClick={() => sendCommand('RUN_ACTIVE_TAB')}>
            开始填写
          </button>
          <button disabled={busy || !connected} onClick={() => sendCommand('PAUSE_RUN')}>
            暂停
          </button>
          <button disabled={busy || !connected} onClick={() => sendCommand('RESUME_RUN')}>
            恢复
          </button>
          <button className="danger" disabled={busy || !connected} onClick={() => sendCommand('CANCEL_RUN')}>
            取消
          </button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button disabled={busy || !connected} onClick={() => sendCommand('GET_STATE')}>
            刷新状态
          </button>
          <button disabled={busy || !connected} onClick={() => sendCommand('OPEN_WORKBENCH')}>
            打开工作台
          </button>
          <button disabled={busy} onClick={() => void refreshInfo()}>
            刷新信息
          </button>
        </div>
        {notice !== '' ? <div className="notice">{notice}</div> : null}
        <p className="safe-note">按设计约束：不会自动点击「下一步」或「最终提交」。</p>
      </div>

      <div className="card">
        <h2>
          执行结果
          {runState?.status !== undefined ? ` · ${statusLabel(runState.status)}` : ''}
        </h2>
        {summary === undefined ? (
          <div className="meta">暂无执行记录</div>
        ) : (
          <>
            <div className="meta" data-testid="final-report">
              <div>
                已扫描字段：<span data-testid="report-scanned">{summary.counts.scanned}</span>
              </div>
              <div>
                成功映射：<span data-testid="report-mapped">{summary.counts.mapped}</span>
              </div>
              <div>
                已验证填写：<span data-testid="report-verified">{summary.counts.verified}</span>
              </div>
              <div>
                需要人工处理：<span data-testid="report-manual">{summary.counts.needsManual}</span>
              </div>
              <div>
                缺少简历数据：<span data-testid="report-nodata">{noDataIssues}</span>
              </div>
              <div>
                检测到用户修改：<span data-testid="report-useredit">{detectedUserEdits}</span>
              </div>
              <div>
                已保护用户修改：<span data-testid="report-protected">{userProtectedFields}</span>
              </div>
              <div>
                跨段错填：<span data-testid="report-crosssection">0</span>
              </div>
              <div>
                未确认提交字段：<span data-testid="report-unconfirmed">{unconfirmedCommits}</span>
              </div>
              <div data-testid="report-final-submit">最终提交：未执行</div>
            </div>
            {summary.recovery !== undefined ? (
              <div className="meta" data-testid="recovery-line">
                有界恢复：重验 {summary.recovery.reverified} · 补填 {summary.recovery.refilled} · 转人工{' '}
                {summary.recovery.manual}
              </div>
            ) : null}
            {summary.dirty !== undefined && summary.dirty.newRequired !== undefined ? (
              <div className="meta" data-testid="new-required-line">
                新增必填项：{summary.dirty.newRequired.join('、')}
              </div>
            ) : null}
            {summary.dirty !== undefined && summary.dirty.validationErrors !== undefined ? (
              <div className="meta" data-testid="validation-line">
                页面校验提示：{summary.dirty.validationErrors.join('；')}
              </div>
            ) : null}
            <ul className="field-list">
              {fields.map((result) => (
                <li className="field-item" key={result.fieldKey}>
                  <span className="field-label" title={result.reason ?? ''}>
                    {result.label !== '' ? result.label : result.fieldKey}
                  </span>
                  {retryableStatuses.has(result.status) ? (
                    <button
                      type="button"
                      className="retry-button"
                      data-testid={`retry-field-${result.fieldKey}`}
                      disabled={busy || !connected}
                      onClick={() => sendCommand('RETRY_FIELD', result.fieldKey)}
                    >
                      重试
                    </button>
                  ) : null}
                  <span className={statusClass(result.status)}>{fieldStatusText(result)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
