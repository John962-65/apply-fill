import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import { CORRECTIONS_KEY, JOB_CONTEXTS_KEY, JOB_VERSIONS_KEY } from '@/shared/contracts/context';
import type { ApplicationContext, CorrectionResponse, JobContextResponse, JobVersion, UserCorrectionRecord } from '@/shared/contracts/context';
import { extractPdfText } from '@/resume/parser/pdfText';
import { extractResumeFacts, markFactsVerified } from '@/resume/parser/resumeStructureExtractor';
import type { ResumeParseStats } from '@/resume/parser/resumeStructureExtractor';
import { loadAttachment, saveAttachment } from '@/resume/storage/attachmentStore';
import type {
  LlmConfigResponse,
  LlmConfigView,
  LlmProviderConfig,
  LlmTestConnectionResponse,
} from '@/shared/contracts/llm';
import { llmBaseUrlOriginPattern } from '@/shared/contracts/llm';
import type { CompiledResume, ResumeFactsDocument, ResumeVersionInfo } from '@/shared/contracts/resume';
import type { ActiveTabInfo, CompiledResumeResponse, ResumeStatusInfo, SimpleAck, UploadAttachmentResponse } from '@/shared/messages/protocol';
import { createSampleResumeFacts } from '@/shared/samples/sampleResume';
import { requestPermissionWithTimeout } from '@/shared/utils';

const CORRECTION_KIND_LABELS: Record<UserCorrectionRecord['kind'], string> = {
  REMAP: '来源修正',
  MANUAL_EDIT: '手动完成',
};

export function App() {
  const [json, setJson] = useState('');
  const [notice, setNotice] = useState('');
  const [status, setStatus] = useState<ResumeStatusInfo | null>(null);
  const [compiled, setCompiled] = useState<CompiledResume | null>(null);
  const [versions, setVersions] = useState<ResumeVersionInfo[]>([]);
  const [versionLabel, setVersionLabel] = useState('');
  const [versionBusy, setVersionBusy] = useState(false);
  const resumeLoadRevision = useRef(0);
  const [attachmentName, setAttachmentName] = useState('');
  const [uploadNotice, setUploadNotice] = useState('');
  const [corrections, setCorrections] = useState<UserCorrectionRecord[]>([]);
  const [jdContexts, setJdContexts] = useState<ApplicationContext[]>([]);
  const [jobVersions, setJobVersions] = useState<JobVersion[]>([]);
  const [jdNotice, setJdNotice] = useState('');
  const correctionLoadRevision = useRef(0);
  const contextLoadRevision = useRef(0);
  const [llmConfig, setLlmConfig] = useState<LlmConfigView | null>(null);
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmNotice, setLlmNotice] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseNotice, setParseNotice] = useState('');
  const [parseStats, setParseStats] = useState<ResumeParseStats | null>(null);
  const [parseJson, setParseJson] = useState('');

  const loadLlmConfig = useCallback(async () => {
    const response = (await chrome.runtime.sendMessage({ type: 'GET_LLM_CONFIG' })) as LlmConfigResponse;
    setLlmConfig(response?.config ?? null);
  }, []);

  const patchLlmConfig = useCallback((patch: Partial<LlmConfigView>) => {
    setLlmConfig((prev) => (prev === null ? prev : { ...prev, ...patch }));
  }, []);

  const saveLlmConfig = useCallback(async () => {
    if (llmConfig === null) {
      return;
    }
    const patch: Partial<LlmProviderConfig> = {
      enabled: llmConfig.enabled,
      baseUrl: llmConfig.baseUrl,
      model: llmConfig.model,
      temperature: llmConfig.temperature,
      maxFieldsPerRequest: llmConfig.maxFieldsPerRequest,
      timeoutMs: llmConfig.timeoutMs,
      maxRetries: llmConfig.maxRetries,
    };
    if (llmApiKey !== '') {
      patch.apiKey = llmApiKey;
    }
    const response = (await chrome.runtime.sendMessage({ type: 'SET_LLM_CONFIG', config: patch })) as LlmConfigResponse;
    if (response?.ok === true) {
      setLlmConfig(response.config ?? null);
      setLlmApiKey('');
      setLlmNotice('配置已保存（API Key 仅保存在本机浏览器存储）');
    } else {
      setLlmNotice(`保存失败：${response?.message ?? '未知错误'}`);
    }
  }, [llmConfig, llmApiKey]);

  const clearLlmApiKey = useCallback(async () => {
    const response = (await chrome.runtime.sendMessage({
      type: 'SET_LLM_CONFIG',
      config: { apiKey: '' },
    })) as LlmConfigResponse;
    if (response?.ok === true) {
      setLlmConfig(response.config ?? null);
      setLlmApiKey('');
      setLlmNotice('已清除本地 API Key');
    }
  }, []);

  const authorizeLlmHost = useCallback(() => {
    const pattern = llmBaseUrlOriginPattern(llmConfig?.baseUrl ?? '');
    if (pattern === undefined) {
      setLlmNotice('请先填写有效的 Base URL（需为 HTTPS，本地调试可用 http://localhost）');
      return;
    }
    const request = chrome.permissions.request({ origins: [pattern] });
    setLlmNotice(`已发起对 ${pattern} 的访问授权，请在浏览器弹窗中确认…`);
    void requestPermissionWithTimeout(request).then(async (granted) => {
      let verified = false;
      if (granted) {
        try {
          verified = await chrome.permissions.contains({ origins: [pattern] });
        } catch {
          verified = false;
        }
      }
      setLlmNotice(
        verified
          ? `已获得 ${pattern} 的访问授权，可以测试连接`
          : `未获得 ${pattern} 的访问授权（授权弹窗未确认或已被拒绝），请重试`,
      );
    });
  }, [llmConfig]);

  const testLlmConnection = useCallback(async () => {
    const pattern = llmBaseUrlOriginPattern(llmConfig?.baseUrl ?? '');
    if (pattern !== undefined) {
      let granted = false;
      try {
        granted = await chrome.permissions.contains({ origins: [pattern] });
      } catch {
        granted = false;
      }
      if (!granted) {
        setLlmNotice('尚未授权访问模型服务域名，请先点击「授权模型服务」');
        return;
      }
    }
    setLlmNotice('正在测试连接…');
    const response = (await chrome.runtime.sendMessage({ type: 'LLM_TEST_CONNECTION' })) as LlmTestConnectionResponse;
    setLlmNotice(
      response?.ok === true
        ? `连接成功：${response.message ?? ''}`
        : `连接失败：${response.message ?? '未知错误'}`,
    );
  }, [llmConfig]);

  const loadJdContexts = useCallback(async () => {
    const revision = ++contextLoadRevision.current;
    const response = await chrome.runtime.sendMessage({ type: 'LIST_JOB_CONTEXTS' }) as JobContextResponse;
    if (response?.ok && revision === contextLoadRevision.current) setJdContexts(response.contexts ?? []);
    const saved = await chrome.runtime.sendMessage({ type: 'LIST_JOB_VERSIONS' }) as JobContextResponse;
    if (saved?.ok && revision === contextLoadRevision.current) setJobVersions(saved.versions ?? []);
  }, []);

  const loadCorrections = useCallback(async () => {
    const revision = ++correctionLoadRevision.current;
    const response = await chrome.runtime.sendMessage({ type: 'LOAD_CORRECTIONS' }) as CorrectionResponse;
    if (response?.ok && revision === correctionLoadRevision.current) setCorrections(response.snapshot?.records.slice().reverse() ?? []);
  }, []);

  useEffect(() => {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ): void => {
      if (area === 'local' && changes[CORRECTIONS_KEY] !== undefined) {
        void loadCorrections();
      }
      if ((area === 'session' && changes[JOB_CONTEXTS_KEY] !== undefined) || (area === 'local' && changes[JOB_VERSIONS_KEY] !== undefined)) {
        void loadJdContexts();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [loadCorrections, loadJdContexts]);

  const dismissCorrection = useCallback(
    async (id: string) => {
      const response = await chrome.runtime.sendMessage({ type: 'REMOVE_CORRECTION', id }) as SimpleAck;
      if (!response?.ok) { setNotice('删除修正记录失败，请重试'); return; }
      await loadCorrections();
    },
    [loadCorrections],
  );

  const clearCorrections = useCallback(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'CLEAR_CORRECTIONS' }) as SimpleAck;
    if (!response?.ok) { setNotice('清除修正记录失败，请重试'); return; }
    await loadCorrections();
  }, [loadCorrections]);

  const assignJobContext = useCallback(async (id: string) => {
    const target = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_INFO' }) as ActiveTabInfo;
    if (target.tabId === undefined) { setJdNotice('请先打开需要填写的招聘页面'); return; }
    const response = await chrome.runtime.sendMessage({ type: 'ASSIGN_JOB_CONTEXT', id, tabId: target.tabId }) as JobContextResponse;
    setJdNotice(response?.ok ? `已用于当前页面：${target.title ?? target.url ?? ''}` : '选择失败，请确认已授权当前页面且岗位缓存未过期');
    if (response?.ok) await loadJdContexts();
  }, [loadJdContexts]);

  const changeJobVersion = useCallback(async (type: 'SAVE_JOB_VERSION' | 'DELETE_JOB_VERSION' | 'ASSIGN_JOB_VERSION', id: string) => {
    const target = type === 'ASSIGN_JOB_VERSION' ? await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_INFO' }) as ActiveTabInfo : undefined;
    const response = await chrome.runtime.sendMessage({ type, id, ...(target?.tabId === undefined ? {} : { tabId: target.tabId }) }) as JobContextResponse;
    setJdNotice(response.ok ? type === 'SAVE_JOB_VERSION' ? '已保存岗位版本到本机' : type === 'DELETE_JOB_VERSION' ? '已删除岗位版本' : '已用于当前页面' : '岗位版本操作失败，请检查当前页面授权');
    if (response.ok) await loadJdContexts();
  }, [loadJdContexts]);

  const refresh = useCallback(async () => {
    const revision = ++resumeLoadRevision.current;
    const [info, response, history, stored] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_RESUME_STATUS' }) as Promise<ResumeStatusInfo>,
      chrome.runtime.sendMessage({ type: 'GET_COMPILED_RESUME' }) as Promise<CompiledResumeResponse>,
      chrome.runtime.sendMessage({ type: 'LIST_RESUME_VERSIONS' }) as Promise<{ versions?: ResumeVersionInfo[] }>, loadAttachment(),
    ]);
    if (revision !== resumeLoadRevision.current) return;
    setStatus(info); setCompiled((response?.document as CompiledResume | null) ?? null);
    setVersions(history?.versions ?? []); setAttachmentName(stored?.name ?? '');
  }, []);

  useEffect(() => {
    void refresh();
    void loadCorrections();
    void loadJdContexts();
    void loadLlmConfig();
  }, [refresh, loadCorrections, loadJdContexts, loadLlmConfig]);

  useEffect(() => {
    const listener = (message: { type?: string }, sender: chrome.runtime.MessageSender) => {
      if (message.type === 'RESUME_CHANGED' && sender.id === chrome.runtime.id && !/^https?:/.test(sender.url ?? '')) void refresh();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  const changeVersion = useCallback(async (type: 'ACTIVATE_RESUME_VERSION' | 'DELETE_RESUME_VERSION', id: string) => {
    setVersionBusy(true);
    try {
      const result = await chrome.runtime.sendMessage({ type, id }) as { ok: boolean; error?: string };
      setNotice(result.ok ? type === 'ACTIVATE_RESUME_VERSION' ? '已切换简历版本' : '已删除历史版本' :
        result.error === 'RUN_IN_PROGRESS' ? '填写任务进行中，请结束任务后再操作版本' : '版本操作失败，当前使用的版本不能删除');
      if (result.ok) await refresh();
    } finally { setVersionBusy(false); }
  }, [refresh]);

  const importResume = useCallback(async () => {
    if (json.trim() === '') {
      setNotice('请先在文本框粘贴 JSON 简历数据，或点击「载入示例简历」');
      return;
    }
    try {
      const facts = JSON.parse(json) as unknown;
      const result = (await chrome.runtime.sendMessage({ type: 'IMPORT_RESUME', facts, label: versionLabel })) as {
        ok: boolean;
        error?: string;
      };
      if (result?.ok === true) {
        setNotice('导入并编译成功');
        await refresh();
      } else {
        setNotice(result?.error === 'RUN_IN_PROGRESS' ? '填写任务进行中，请结束任务后再导入' : `导入失败：${result?.error ?? '未知错误'}`);
      }
    } catch (error) {
      setNotice(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [json, refresh, versionLabel]);

  const clearResume = useCallback(async () => {
    const result = await chrome.runtime.sendMessage({ type: 'CLEAR_RESUME' }) as { ok: boolean };
    setNotice(result.ok ? '已清空简历及历史版本' : '填写任务进行中，请结束任务后再清空');
    if (result.ok) await refresh();
  }, [refresh]);

  const loadSample = useCallback(() => {
    setJson(JSON.stringify(createSampleResumeFacts(), null, 2));
    setNotice('已载入示例简历（点击“导入并编译”写入知识库）');
  }, []);

  const pickAttachment = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file === undefined) {
      return;
    }
    const bytes = await file.arrayBuffer();
    await saveAttachment({
      name: file.name,
      type: file.type !== '' ? file.type : 'application/pdf',
      size: file.size,
      bytes,
      savedAt: Date.now(),
    });
    setAttachmentName(file.name);
    setUploadNotice(`已保存附件：${file.name}（${Math.max(1, Math.round(file.size / 1024))} KB）`);
  }, []);

  const parseAttachment = useCallback(async () => {
    const stored = await loadAttachment();
    if (stored === null) {
      setParseNotice('请先选择 PDF 附件');
      return;
    }
    setParsing(true);
    setParseStats(null);
    setParseJson('');
    setParseNotice('正在本地解析 PDF（不上传任何数据）…');
    const textResult = await extractPdfText(stored.bytes);
    if (!textResult.ok) {
      setParseNotice(`PDF 文本提取失败：${textResult.error ?? '未知错误'}`);
      setParsing(false);
      return;
    }
    if (textResult.empty) {
      setParseNotice('未能提取到文字（可能是扫描件/图片型 PDF），暂不支持 OCR 识别');
      setParsing(false);
      return;
    }
    const parsed = extractResumeFacts(textResult.text);
    setParseStats(parsed.stats);
    setParseJson(JSON.stringify(parsed.facts, null, 2));
    setParseNotice(
      `已提取 ${textResult.pageCount} 页文本（${textResult.text.replace(/\s/g, '').length} 字），请核对下方结果后确认导入`,
    );
    setParsing(false);
  }, []);

  const confirmParsedImport = useCallback(async () => {
    if (parseJson.trim() === '') {
      setParseNotice('没有可导入的解析结果');
      return;
    }
    try {
      const facts = JSON.parse(parseJson) as ResumeFactsDocument;
      const result = (await chrome.runtime.sendMessage({ type: 'IMPORT_RESUME', facts: markFactsVerified(facts) })) as {
        ok: boolean;
        error?: string;
      };
      if (result?.ok === true) {
        setParseNotice('已确认导入并写入知识库');
        setParseStats(null);
        setParseJson('');
        await refresh();
      } else {
        setParseNotice(`导入失败：${result?.error ?? '未知错误'}`);
      }
    } catch (error) {
      setParseNotice(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [parseJson, refresh]);

  const cancelParse = useCallback(() => {
    setParseStats(null);
    setParseJson('');
    setParseNotice('已取消本次解析结果');
  }, []);

  const uploadAttachment = useCallback(async () => {
    const response = (await chrome.runtime.sendMessage({ type: 'UPLOAD_ATTACHMENT' })) as
      | UploadAttachmentResponse
      | undefined;
    const status = response?.status ?? 'NO_RESPONSE';
    const prefix = response?.ok === true ? '上传成功' : '上传未确认';
    setUploadNotice(`${prefix} [${status}]：${response?.message ?? ''}`);
  }, []);

  const exportCompiled = useCallback(() => {
    if (compiled === null) {
      setNotice('当前没有已编译的简历');
      return;
    }
    const blob = new Blob([JSON.stringify(compiled, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'applyfill-compiled-resume.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [compiled]);

  return (
    <div className="workbench">
      <div className="card">
        <h2>三层简历知识库 · 原始事实层导入</h2>
        <input data-testid="version-label" aria-label="简历版本名称" placeholder="版本名称（可选，例如：前端岗位）" value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} />
        <textarea
          data-testid="resume-json"
          value={json}
          onChange={(event) => setJson(event.target.value)}
          spellCheck={false}
        />
        <div style={{ marginTop: 10 }}>
          <button data-testid="import-resume" className="primary" onClick={() => void importResume()}>
            导入并编译
          </button>
          <button onClick={loadSample}>载入示例简历</button>
          <button onClick={() => void clearResume()}>清空简历</button>
          <button onClick={() => void refresh()}>刷新状态</button>
          <button onClick={exportCompiled}>导出已编译 JSON</button>
          <button disabled={compiled === null} onClick={() => {
            if (compiled !== null) setJson(JSON.stringify(compiled.facts, null, 2));
          }}>编辑当前简历</button>
        </div>
        {notice !== '' ? (
          <p className="notice" data-testid="import-notice">
            {notice}
          </p>
        ) : null}
      </div>

      <div className="card">
        <h2>简历版本</h2>
        <p>每次导入保留一个版本，最多保存最近 20 个。切换后使用选定版本填写；清空简历会删除全部历史版本。</p>
        {versions.length === 0 ? <p>暂无历史版本</p> : versions.map((version) => (
          <div key={version.id} data-testid="resume-version">
            <span>{version.label}</span> · {new Date(version.createdAt).toLocaleString()} {version.active ? '（当前使用）' : ''}
            <button data-testid="version-activate" disabled={versionBusy || version.active} onClick={() => void changeVersion('ACTIVATE_RESUME_VERSION', version.id)}>使用此版本</button>
            <button data-testid="version-delete" disabled={versionBusy || version.active} onClick={() => void changeVersion('DELETE_RESUME_VERSION', version.id)}>删除</button>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>简历附件（PDF）</h2>
        <p style={{ fontSize: 13 }}>选择附件后点击“上传附件到当前页面”，扩展会在目标页尝试注入文件并验证网站接收状态。</p>
        <input
          data-testid="attachment-input"
          type="file"
          accept=".pdf,application/pdf"
          onChange={(event) => void pickAttachment(event)}
        />
        <div style={{ marginTop: 10 }}>
          <button data-testid="upload-attachment" className="primary" onClick={() => void uploadAttachment()}>
            上传附件到当前页面
          </button>
          <button data-testid="parse-attachment" disabled={parsing} onClick={() => void parseAttachment()}>
            解析为简历（本地）
          </button>
          <span style={{ marginLeft: 10, fontSize: 13 }}>
            {attachmentName === '' ? '未选择附件' : `当前附件：${attachmentName}`}
          </span>
        </div>
        {parseNotice !== '' ? (
          <p className="notice" data-testid="parse-notice">
            {parseNotice}
          </p>
        ) : null}
        {parseStats !== null ? (
          <div data-testid="parse-preview" style={{ marginTop: 10 }}>
            <p style={{ fontSize: 13 }} data-testid="parse-stats">
              个人信息 {parseStats.basic.length} 项 · 教育经历 {parseStats.education} 段 · 工作/实习{' '}
              {parseStats.work} 段 · 项目经历 {parseStats.projects} 段 · 技能/证书 {parseStats.skills} 项 · 需要确认{' '}
              {parseStats.uncertain.length} 项
            </p>
            {parseStats.uncertain.length > 0 ? (
              <ul data-testid="parse-uncertain" style={{ paddingLeft: 18, fontSize: 12, color: '#a15c00' }}>
                {parseStats.uncertain.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            <textarea
              data-testid="parse-json"
              style={{ minHeight: 160, width: '100%' }}
              value={parseJson}
              spellCheck={false}
              onChange={(event) => setParseJson(event.target.value)}
            />
            <div style={{ marginTop: 8 }}>
              <button data-testid="parse-confirm" className="primary" onClick={() => void confirmParsedImport()}>
                确认导入
              </button>
              <button data-testid="parse-cancel" onClick={cancelParse}>
                取消
              </button>
            </div>
          </div>
        ) : null}
        {uploadNotice !== '' ? (
          <p className="notice" data-testid="upload-notice">
            {uploadNotice}
          </p>
        ) : null}
      </div>

      <div className="card">
        <h2>字段修正记录（映射记忆确认）</h2>
        <p style={{ fontSize: 13 }}>
          用户对字段来源的修正会写入本地映射记忆，便于后续访问自动沿用。记录仅包含字段标识与目标路径，不保存字段值。
        </p>
        {corrections.length === 0 ? (
          <p style={{ fontSize: 13 }} data-testid="correction-empty">
            暂无修正记录
          </p>
        ) : (
          <>
            <ul data-testid="correction-list" style={{ paddingLeft: 18, fontSize: 13 }}>
              {corrections.map((record) => (
                <li key={record.id} data-testid="correction-item">
                  [{CORRECTION_KIND_LABELS[record.kind]}] {record.host} · {record.label}
                  {record.targetPath !== undefined ? ` → ${record.targetPath}` : ''}
                  <button
                    style={{ marginLeft: 8 }}
                    data-testid="correction-dismiss"
                    onClick={() => void dismissCorrection(record.id)}
                  >
                    忽略
                  </button>
                </li>
              ))}
            </ul>
            <button data-testid="correction-clear" onClick={() => void clearCorrections()}>
              全部清除
            </button>
          </>
        )}
      </div>

      <div className="card">
        <h2>岗位上下文缓存（临时 JD）</h2>
        <p style={{ fontSize: 13 }}>岗位仅自动用于采集它的页面。手动选择后用于当前页面及已授权的内嵌表单；缓存有效期为六小时。</p>
        {jdNotice ? <p className="notice" data-testid="jd-notice">{jdNotice}</p> : null}
        {jdContexts.length === 0 ? (
          <p style={{ fontSize: 13 }} data-testid="jd-empty">
            暂无岗位上下文（在含职位描述的页面执行一次填写后缓存）
          </p>
        ) : (
          jdContexts.map((context) => (
            <div key={context.id} data-testid="jd-context" style={{ fontSize: 13, marginBottom: 8 }}>
              <p>
                岗位：<span data-testid="jd-title">{context.title ?? '未知'}</span> · 公司：
                <span data-testid="jd-company">{context.company ?? '未知'}</span>
              </p>
              <p>
                来源：<span data-testid="jd-source">{context.source === 'jsonld' ? 'JSON-LD' : 'DOM 启发式'}</span> · 有效期至{' '}
                {new Date(context.expiresAt).toLocaleString()}
              </p>
              {context.responsibilities !== undefined ? (
                <p data-testid="jd-responsibilities">职责：{context.responsibilities.slice(0, 120)}</p>
              ) : null}
              {context.requirements !== undefined ? (
                <p data-testid="jd-requirements">要求：{context.requirements.slice(0, 120)}</p>
              ) : null}
              <button data-testid="jd-select" onClick={() => context.id && void assignJobContext(context.id)}>用于当前目标页</button>
              <button data-testid="jd-save-version" onClick={() => context.id && void changeJobVersion('SAVE_JOB_VERSION', context.id)}>保存岗位版本</button>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h2>已保存岗位版本</h2>
        <p>岗位版本保存在本机，最多 20 个。只有点击使用后才应用到当前页面，临时上下文仍保留六小时有效期。</p>
        {jobVersions.map((version) => <div key={version.id} data-testid="job-version">
          {version.label} · {new Date(version.capturedAt).toLocaleString()}
          <button data-testid="job-version-use" onClick={() => void changeJobVersion('ASSIGN_JOB_VERSION', version.id)}>用于当前目标页</button>
          <button data-testid="job-version-delete" onClick={() => void changeJobVersion('DELETE_JOB_VERSION', version.id)}>删除</button>
        </div>)}
      </div>

      <div className="card">
        <h2>AI 模型设置（云端语义辅助 · LLM）</h2>
        <p style={{ fontSize: 13 }}>
          当本地规则与缓存无法识别表单字段时，可选择把字段标签等元信息（不含任何简历内容）发送到你自己配置的
          OpenAI 兼容接口，由模型返回简历路径建议。默认关闭；API Key 仅保存在本机浏览器存储中，不会上传到任何其他服务器。
          首次使用需先点击「授权模型服务」在浏览器弹窗中允许访问所填域名（可随时在扩展管理页撤销）。
        </p>
        <label style={{ display: 'block', fontSize: 13, marginTop: 8 }}>
          <input
            data-testid="llm-enabled"
            type="checkbox"
            checked={llmConfig?.enabled ?? false}
            onChange={(event) => patchLlmConfig({ enabled: event.target.checked })}
          />{' '}
          启用云端语义辅助（默认关闭）
        </label>
        <div style={{ marginTop: 8 }}>
          <input
            data-testid="llm-baseurl"
            placeholder="Base URL（OpenAI 兼容，如 https://api.example.com/v1）"
            style={{ width: '100%' }}
            value={llmConfig?.baseUrl ?? ''}
            onChange={(event) => patchLlmConfig({ baseUrl: event.target.value })}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <input
            data-testid="llm-apikey"
            type="password"
            placeholder={llmConfig?.hasApiKey === true ? 'API Key（已保存，留空保持不变）' : 'API Key'}
            style={{ width: '100%' }}
            value={llmApiKey}
            onChange={(event) => setLlmApiKey(event.target.value)}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <input
            data-testid="llm-model"
            placeholder="模型名称（如 gpt-4o-mini）"
            style={{ width: '100%' }}
            value={llmConfig?.model ?? ''}
            onChange={(event) => patchLlmConfig({ model: event.target.value })}
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <button data-testid="llm-save" className="primary" onClick={() => void saveLlmConfig()}>
            保存配置
          </button>
          <button data-testid="llm-authorize" onClick={authorizeLlmHost}>
            授权模型服务
          </button>
          <button data-testid="llm-test" onClick={() => void testLlmConnection()}>
            测试连接
          </button>
          <button data-testid="llm-clear-key" onClick={() => void clearLlmApiKey()}>
            清除密钥
          </button>
        </div>
        <p style={{ fontSize: 12, color: '#666' }}>
          高级参数：温度 {llmConfig?.temperature ?? 0} · 单次最大字段数 {llmConfig?.maxFieldsPerRequest ?? 20} · 超时{' '}
          {llmConfig?.timeoutMs ?? 10000}ms · 重试 {llmConfig?.maxRetries ?? 1} 次
        </p>
        {llmNotice !== '' ? (
          <p className="notice" data-testid="llm-notice">
            {llmNotice}
          </p>
        ) : null}
      </div>

      <div className="card">
        <h2>知识库状态</h2>
        <p style={{ fontSize: 13 }}>
          {status?.hasResume === true
            ? `已导入：${status.name ?? ''} · 编译时间 ${status.compiledAt !== undefined ? new Date(status.compiledAt).toLocaleString() : '未知'}`
            : '尚未导入任何简历'}
        </p>
      </div>

      <div className="card">
        <h2>规范化语义层（Layer 1）与表单适配切面（Layer 2）预览</h2>
        <pre>{compiled === null ? '无数据' : JSON.stringify({ normalized: compiled.normalized, projections: compiled.projections }, null, 2)}</pre>
      </div>
    </div>
  );
}
