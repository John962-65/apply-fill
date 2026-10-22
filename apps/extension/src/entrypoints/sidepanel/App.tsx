import { useCallback, useEffect, useRef, useState } from 'react';
import { issueNeedsAttention, mappingIssueText } from '@/shared/utils/runReport';

import type { FieldExecutionResult, FieldStatus } from '@/shared/contracts/field';
import type { SessionRunState } from '@/shared/contracts/run';
import type { ActiveTabInfo, PanelPortMessage, ResumeStatusInfo, TabCommand } from '@/shared/messages/protocol';
import { hostPermissionPattern, requestPermissionWithTimeout } from '@/shared/utils';
import { createId } from '@/shared/utils/id';

const STATUS_TEXT: Record<string, string> = {
  IDLE: '未开始', RUNNING: '填写中', PAUSED: '已暂停', COMPLETED: '已完成', FAILED: '失败', INTERRUPTED: '已中断',
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
  const pendingCommand = useRef<{ requestId: string; command: TabCommand; tabId?: number } | null>(null);
  const refreshRevision = useRef(0);
  const [connected, setConnected] = useState(false);
  const [runState, setRunState] = useState<SessionRunState | null>(null);
  const [resumeStatus, setResumeStatus] = useState<ResumeStatusInfo | null>(null);
  const [tabInfo, setTabInfo] = useState<ActiveTabInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const refreshInfo = useCallback(async () => {
    const revision = ++refreshRevision.current;
    const status = (await chrome.runtime.sendMessage({ type: 'GET_RESUME_STATUS' })) as ResumeStatusInfo;
    if (revision !== refreshRevision.current) return;
    setResumeStatus(status);
    const info = (await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_INFO' })) as ActiveTabInfo;
    if (revision !== refreshRevision.current) return;
    setTabInfo(info);
  }, []);

  useEffect(() => {
    let disposed = false;
    let port: chrome.runtime.Port | undefined;
    void (async () => {
      let windowId = -1;
      try {
        const current = await chrome.windows.getCurrent();
        if (current.id !== undefined) {
          windowId = current.id;
        }
      } catch {
        // Ignore window lookup failures and connect without a window id
      }
      if (disposed) {
        return;
      }
      port = chrome.runtime.connect({ name: `sidepanel:${windowId}` });
      portRef.current = port;
      setConnected(true);
      port.onMessage.addListener((message: PanelPortMessage) => {
        if (message.type === 'RUN_STATE') {
          const state = message.state;
          setRunState((current) => {
            if (current && state && state.tabId === current.tabId && state.updatedAt < current.updatedAt) return current;
            if (current && state && state.runId === current.runId && !['RUNNING', 'PAUSED'].includes(current.status) && ['RUNNING', 'PAUSED'].includes(state.status)) return current;
            return state;
          });
        } else if (message.type === 'RUN_EVENT') {
          port?.postMessage({ type: 'PANEL_COMMAND', command: 'GET_STATE' } satisfies PanelPortMessage);
        } else if (message.type === 'TAB_INFO_UPDATED') {
          setTabInfo(message.info);
        } else if (message.type === 'COMMAND_RESULT') {
          if (message.requestId && pendingCommand.current?.requestId !== message.requestId) return;
          const tabId = pendingCommand.current?.tabId;
          if (message.summary && tabId !== undefined) setRunState({ tabId, runId: message.summary.runId,
            status: message.summary.status, summary: message.summary, updatedAt: Date.now(), startedAt: message.summary.startedAt });
          pendingCommand.current = null;
          setBusy(false);
          setNotice(message.message ?? '');
          void refreshInfo();
        }
      });
      port.onDisconnect.addListener(() => {
        setConnected(false);
        portRef.current = null;
      });
      void refreshInfo();
    })();
    return () => {
      disposed = true;
      port?.disconnect();
    };
  }, [refreshInfo]);

  useEffect(() => {
    const handleActivated = () => void refreshInfo();
    const handleUpdated = (_tabId: number, change: { url?: string; status?: string }) => {
      if (change.url || change.status === 'complete') {
        void refreshInfo();
      }
    };
    chrome.tabs.onActivated.addListener(handleActivated);
    chrome.tabs.onUpdated.addListener(handleUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(handleActivated);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
    };
  }, [refreshInfo]);

  const sendCommand = useCallback((command: TabCommand, fieldKey?: string) => {
    const requestId = createId('command');
    if (command !== 'GET_STATE') {
      setBusy(true);
      setNotice('');
      pendingCommand.current = { requestId, command, ...(tabInfo?.tabId !== undefined ? { tabId: tabInfo.tabId } : {}) };
    }
    portRef.current?.postMessage({
      type: 'PANEL_COMMAND',
      command,
      requestId,
      ...(tabInfo?.tabId !== undefined ? { tabId: tabInfo.tabId } : {}),
      ...(fieldKey !== undefined ? { fieldKey } : {}),
    } satisfies PanelPortMessage);
  }, [tabInfo?.tabId]);

  const requestPermission = useCallback(async () => {
    if (!tabInfo?.url) return;
    setBusy(true);
    try {
      const pattern = hostPermissionPattern(tabInfo.url);
      if (pattern === undefined) {
        setNotice('当前页面不支持网站授权');
        return;
      }
      let granted = false;
      try {
        granted = await chrome.permissions.contains({ origins: [pattern] });
      } catch {
        granted = false;
      }
      if (!granted) {
        try {
          granted = await requestPermissionWithTimeout(chrome.permissions.request({ origins: [pattern] }));
        } catch {
          granted = false;
        }
      }
      if (!granted) {
        setNotice('未获得网站访问权限（授权弹窗未确认或已被拒绝），请重试');
        return;
      }
      let verified = false;
      try {
        verified = await chrome.permissions.contains({ origins: [pattern] });
      } catch {
        verified = false;
      }
      if (!verified) {
        setNotice('浏览器权限验证失败，请重试');
        return;
      }
      const res = (await chrome.runtime.sendMessage({
        type: 'AUTHORIZE_TAB',
        tabId: tabInfo.tabId,
      })) as { ok: boolean; message?: string };
      if (res.ok) {
        setNotice('已获得该网站访问权限并成功连接内容脚本');
      } else {
        setNotice(res.message ?? '授权失败');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '申请权限失败');
    } finally {
      setBusy(false);
      await refreshInfo();
    }
  }, [refreshInfo, tabInfo]);

  const injectScript = useCallback(async () => {
    if (tabInfo?.tabId === undefined) return;
    setBusy(true);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'INJECT_CONTENT_SCRIPT',
        tabId: tabInfo.tabId,
      })) as { ok: boolean; message?: string };
      if (res.ok) {
        setNotice('内容脚本注入成功，已建立连接');
      } else {
        setNotice(res.message ?? '注入失败');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '注入出错');
    } finally {
      setBusy(false);
      await refreshInfo();
    }
  }, [refreshInfo, tabInfo]);

  const summary = runState?.summary;
  const fields = summary?.fields ?? [];
  const openIssues = (summary?.mappingIssues ?? []).filter((issue) => !fields.some((field) => field.fieldKey === issue.fieldKey &&
    ['VERIFIED', 'USER_OVERRIDDEN'].includes(field.status)));
  const manualIssues = openIssues.filter(issueNeedsAttention);
  const optionalIssues = openIssues.filter((issue) => issue.attention === 'optional');
  const populatedIssues = openIssues.filter((issue) => issue.attention === 'filled' || issue.attention === 'unavailable');
  const noDataIssues = manualIssues.filter((issue) => issue.kind === 'NO_DATA').length;
  const userProtectedKeys = new Set([
    ...fields.filter((field) => field.status === 'USER_OVERRIDDEN').map((field) => field.fieldKey),
    ...(summary?.dirty?.userProtected ?? []),
  ]);
  const userProtectedFields = userProtectedKeys.size;
  const detectedUserEdits = userProtectedKeys.size;
  const taskActive = runState?.status === 'RUNNING' || runState?.status === 'PAUSED';
  const taskStarting = busy && pendingCommand.current?.command === 'RUN_ACTIVE_TAB';
  const unconfirmedCommits = fields.filter((field) => field.commit?.status === 'UNKNOWN').length;
  const retryableStatuses = new Set(['NEEDS_MANUAL', 'RETRYABLE', 'CIRCUIT_BROKEN']);

  return (
    <div className="panel">
      <div className="card">
        <h2>当前页面</h2>
        <div className="meta">
          {tabInfo?.url !== undefined ? (
            <>
              <div className="field-label" data-testid="current-tab-title">
                {tabInfo.title ?? '(无标题)'}
              </div>
              <div data-testid="current-tab-url">URL：{tabInfo.url}</div>
              <div data-testid="current-tab-id">标签页 ID：{tabInfo.tabId ?? '-'}</div>
              <div data-testid="current-tab-permission">
                网站授权：{tabInfo.hasPermission ? '已获得权限' : '未授权'}
                {!tabInfo.hasPermission && tabInfo.canInject ? (
                  <button
                    type="button"
                    style={{ marginLeft: 8, padding: '2px 8px', fontSize: 12 }}
                    data-testid="btn-authorize"
                    onClick={() => void requestPermission()}
                  >
                    授权此网站
                  </button>
                ) : null}
              </div>
              <div data-testid="current-tab-connection">
                内容脚本：{tabInfo.contentScriptAlive ? '已连接' : '未连接'}
                {tabInfo.hasPermission && !tabInfo.contentScriptAlive ? (
                  <button
                    type="button"
                    style={{ marginLeft: 8, padding: '2px 8px', fontSize: 12 }}
                    data-testid="btn-inject"
                    onClick={() => void injectScript()}
                  >
                    注入内容脚本
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <div data-testid="no-tab-warning">未找到可操作的网页标签（请在浏览器中打开目标招聘网页）</div>
          )}
          <div>
            简历：{resumeStatus?.hasResume === true ? `已导入（${resumeStatus.name ?? ''}）` : '尚未导入'}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>任务控制</h2>
        <div className="row">
          <button
            className="primary"
            data-testid="start-fill-btn"
            disabled={busy || taskActive || !connected || !tabInfo?.contentScriptAlive || !resumeStatus?.hasResume || !tabInfo?.hasPermission}
            onClick={() => {
              if (!tabInfo?.contentScriptAlive) {
                setNotice('Content Script 未连接：请先授权并注入内容脚本');
                return;
              }
              sendCommand('RUN_ACTIVE_TAB');
            }}
          >
            开始填写
          </button>
          <button disabled={!connected || runState?.status !== 'RUNNING'} onClick={() => sendCommand('PAUSE_RUN')}>
            暂停
          </button>
          <button disabled={!connected || runState?.status !== 'PAUSED'} onClick={() => sendCommand('RESUME_RUN')}>
            恢复
          </button>
          <button className="danger" disabled={!connected || (!taskActive && !taskStarting)} onClick={() => sendCommand('CANCEL_RUN')}>
            取消
          </button>
        </div>
        {!tabInfo?.contentScriptAlive && tabInfo?.url !== undefined ? (
          <div className="notice" data-testid="connection-reason" style={{ color: '#d97706', marginTop: 8 }}>
            {!tabInfo.hasPermission
              ? '当前网站尚未授权访问，无法执行自动填写。请先点击「授权此网站」。'
              : '当前页面尚未连接内容脚本，无法执行自动填写。请先点击「注入内容脚本」。'}
          </div>
        ) : null}
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
        {notice !== '' ? (
          <div className="notice" data-testid="panel-notice">
            {notice}
          </div>
        ) : null}
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
              <div>本次操作：{runState?.operation === 'upload' ? '附件上传' : runState?.operation === 'field' ? '单字段修正' : '整页填写'}</div>
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
              {optionalIssues.length > 0 ? <div>可跳过的选填项：<span data-testid="report-optional">{optionalIssues.length}</span></div> : null}
              {populatedIssues.length > 0 ? <div>已有内容或暂不可编辑：<span data-testid="report-populated">{populatedIssues.length}</span></div> : null}
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
                跨段错填：<span data-testid="report-crosssection">未独立测量</span>
              </div>
              <div>
                未确认提交字段：<span data-testid="report-unconfirmed">{unconfirmedCommits}</span>
              </div>
              <div data-testid="report-final-submit">最终提交：未执行</div>
            </div>
            {summary.llm !== undefined ? (
              <div className="meta" data-testid="llm-line">
                AI 语义辅助：请求 {summary.llm.requested} 字段 · 建议 {summary.llm.proposed} 字段
                {summary.llm.failed ? '（部分请求失败，已回退本地规则）' : ''}
              </div>
            ) : null}
            {summary.mappingIssues.filter((issue) => issue.reason === 'EXPAND_SECTION_AMBIGUOUS').map((issue, index) => (
              <div className="notice" data-testid="repeater-choice-notice" key={`${issue.label}:${index}`}>
                {issue.label}有多个添加入口。请手动添加需要的空白条目，再重新填写。
              </div>
            ))}
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
            <ul className="field-list" data-testid="mapping-issues">
              {manualIssues.map((issue, index) => (
                <li className="field-item" key={`${issue.fieldKey ?? issue.label}:${issue.reason}:${index}`}>
                  <span className="field-label">{issue.label || '经历区块'}</span>
                  <span>{mappingIssueText(issue)}</span>
                </li>
              ))}
            </ul>
            {optionalIssues.length > 0 ? <details data-testid="optional-mapping-issues"><summary>选填项（{optionalIssues.length}），可按需补充</summary>
              <ul className="field-list">{optionalIssues.map((issue, index) => <li className="field-item" key={`${issue.fieldKey}:${index}`}><span className="field-label">{issue.label}</span><span>{mappingIssueText(issue)}</span></li>)}</ul>
            </details> : null}
            {populatedIssues.length > 0 ? <details data-testid="populated-mapping-issues"><summary>已有内容或暂不可编辑（{populatedIssues.length}）</summary>
              <ul className="field-list">{populatedIssues.map((issue, index) => <li className="field-item" key={`${issue.fieldKey}:${index}`}><span className="field-label">{issue.label}</span><span>{mappingIssueText(issue)}</span></li>)}</ul>
            </details> : null}
          </>
        )}
      </div>
    </div>
  );
}
