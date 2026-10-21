import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import { CORRECTIONS_KEY, JOB_CONTEXTS_KEY, JOB_VERSIONS_KEY } from '@/shared/contracts/context';
import type { ApplicationContext, CorrectionResponse, JobContextResponse, JobVersion, UserCorrectionRecord } from '@/shared/contracts/context';
import { extractPdfText } from '@/resume/parser/pdfText';
import { extractResumeFacts } from '@/resume/parser/resumeStructureExtractor';
import type { ResumeParseStats } from '@/resume/parser/resumeStructureExtractor';
import { ReviewPanel } from './ReviewPanel';
import { loadAttachment, saveAttachment } from '@/resume/storage/attachmentStore';
import type {
  LlmConfigResponse,
  LlmConfigView,
  LlmProviderConfig,
  LlmTestConnectionResponse,
} from '@/shared/contracts/llm';
import type { ResumeAiConfig, ResumeAiConfigView } from '@/shared/contracts/resumeAi';
import { resumeAiOriginOf } from '@/shared/contracts/resumeAi';
import { llmBaseUrlOriginPattern } from '@/shared/contracts/llm';
import type { CompiledResume, ResumeFactsDocument, ResumeVersionInfo } from '@/shared/contracts/resume';
import { reviewSummary } from '@/resume/review/facts';
import { formatExtractionWarning } from '@/resume/review/editor';
import type { ActiveTabInfo, CompiledResumeResponse, ResumeAiConfigResponse, ResumeExtractionMessageResponse, ResumeStatusInfo, SimpleAck, UploadAttachmentResponse } from '@/shared/messages/protocol';
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
  const [reviewFacts, setReviewFacts] = useState<ResumeFactsDocument | null>(null);
  const [reviewNotice, setReviewNotice] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [parsedSource, setParsedSource] = useState<{ text: string; pageCount: number; layout?: string } | null>(null);
  const [resumeAiConfig, setResumeAiConfig] = useState<ResumeAiConfigView | null>(null);
  const [resumeAiApiKey, setResumeAiApiKey] = useState('');
  const [resumeAiNotice, setResumeAiNotice] = useState('');
  const [resumeAiDirty, setResumeAiDirty] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);
  const parseRevision = useRef(0);

  const loadLlmConfig = useCallback(async () => {
    const response = (await chrome.runtime.sendMessage({ type: 'GET_LLM_CONFIG' })) as LlmConfigResponse;
    setLlmConfig(response?.config ?? null);
  }, []);

  const patchLlmConfig = useCallback((patch: Partial<LlmConfigView>) => {
    setLlmConfig((prev) => (prev === null ? prev : { ...prev, ...patch }));
  }, []);

  const loadResumeAiConfig = useCallback(async () => {
    const response = (await chrome.runtime.sendMessage({ type: 'GET_RESUME_AI_CONFIG' })) as ResumeAiConfigResponse;
    setResumeAiConfig(response?.config ?? null);
    setResumeAiDirty(false);
  }, []);

  const patchResumeAiConfig = useCallback((patch: Partial<ResumeAiConfigView>) => {
    setResumeAiConfig((prev) => (prev === null ? prev : { ...prev, ...patch }));
    setResumeAiDirty(true);
  }, []);

  const saveResumeAiConfig = useCallback(async () => {
    if (resumeAiConfig === null) return;
    const patch: Partial<ResumeAiConfig> = {
      mode: resumeAiConfig.mode,
      enabled: resumeAiConfig.enabled,
      baseUrl: resumeAiConfig.baseUrl,
      model: resumeAiConfig.model,
      temperature: resumeAiConfig.temperature,
      timeoutMs: resumeAiConfig.timeoutMs,
      maxRetries: resumeAiConfig.maxRetries,
      ...(resumeAiConfig.authorizedOrigin !== undefined ? { authorizedOrigin: resumeAiConfig.authorizedOrigin } : {}),
    };
    if (resumeAiApiKey !== '') patch.apiKey = resumeAiApiKey;
    const response = (await chrome.runtime.sendMessage({ type: 'SET_RESUME_AI_CONFIG', config: patch })) as ResumeAiConfigResponse;
    if (response?.ok === true) {
      setResumeAiConfig(response.config ?? null);
      setResumeAiApiKey('');
      setResumeAiDirty(false);
      setResumeAiNotice('简历解析配置已保存（与字段语义路由配置相互独立）');
    } else {
      setResumeAiNotice(`保存失败：${response?.message ?? response?.error ?? '未知错误'}`);
    }
  }, [resumeAiConfig, resumeAiApiKey]);

  const authorizeResumeAiHost = useCallback(() => {
    const origin = resumeAiOriginOf(resumeAiConfig?.baseUrl ?? '');
    if (origin === undefined) {
      setResumeAiNotice('请先填写有效的 Base URL（需为 HTTPS，本地调试可用 http://localhost）');
      return;
    }
    const pattern = `${origin}/*`;
    setResumeAiNotice(`正在申请 ${origin} 的简历解析授权，请确认浏览器弹窗…`);
    void requestPermissionWithTimeout(chrome.permissions.request({ origins: [pattern] })).then(async (granted) => {
      let verified = false;
      if (granted) {
        try { verified = await chrome.permissions.contains({ origins: [pattern] }); } catch { verified = false; }
      }
      if (!verified) {
        setResumeAiNotice(`未获得 ${origin} 的授权，简历正文不会发送到模型服务`);
        return;
      }
      const response = (await chrome.runtime.sendMessage({
        type: 'SET_RESUME_AI_CONFIG',
        config: { ...resumeAiConfig, ...(resumeAiApiKey ? { apiKey: resumeAiApiKey } : {}), authorizedOrigin: origin },
      })) as ResumeAiConfigResponse;
      if (response?.ok === true) {
        setResumeAiConfig(response.config ?? null);
        setResumeAiApiKey('');
        setResumeAiDirty(false);
        setResumeAiNotice(`配置已保存并授权 ${origin}，现在可以点击“AI 解析简历”。`);
      } else {
        setResumeAiNotice('授权已获得，但配置保存失败，请重试');
      }
    });
  }, [resumeAiConfig, resumeAiApiKey]);

  const extractWithResumeAi = useCallback(async (sourceOverride?: NonNullable<typeof parsedSource>) => {
    if (resumeAiDirty) { setResumeAiNotice('API 设置有修改，请先保存并授权后再解析。'); return; }
    const source = sourceOverride ?? parsedSource;
    if (source === null) {
      setResumeAiNotice('请先选择并解析 PDF 附件');
      return;
    }
    if (resumeAiConfig?.mode !== 'cloud' || resumeAiConfig.enabled !== true) {
      setResumeAiNotice('当前为 Local-Only 模式，简历正文不会发送；请显式切换并授权云端解析');
      return;
    }
    const revision = ++parseRevision.current;
    setExtracting(true);
    setExtractionWarnings([]);
    setResumeAiNotice('正在调用已授权模型进行分章节结构化提取…');
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'RESUME_EXTRACT_TEXT',
        text: source.text,
        pageCount: source.pageCount,
        ...(source.layout !== undefined ? { layout: source.layout } : {}),
      })) as ResumeExtractionMessageResponse;
      if (revision !== parseRevision.current) return;
      if (response?.ok === true && response.facts !== undefined) {
        setReviewFacts(response.facts);
        setParseJson(JSON.stringify(response.facts, null, 2));
        setExtractionWarnings((response.warnings ?? []).map(formatExtractionWarning));
        const summary = reviewSummary(response.facts);
        setParseStats({ basic: Object.keys(response.facts.basic).filter((key) => key !== 'name' || response.facts?.basic.name.value),
          education: response.facts.education.length, work: response.facts.work?.length ?? 0,
          projects: response.facts.projects?.length ?? 0, skills: response.facts.skills?.length ?? 0, uncertain: (response.warnings ?? []).map(formatExtractionWarning) });
        setParseNotice(`AI 已提取 ${summary.total} 项信息，请在下方对照原文核对。`);
        setResumeAiNotice(`AI 解析完成，${summary.total} 项信息等待核对。没有原文支持的内容已列入提示。`);
        document.getElementById('resume-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        const reason = response?.error ?? '未知错误';
        const friendly: Record<string, string> = { RESUME_AI_NOT_AUTHORIZED: '请先授权模型服务域名', RESUME_AI_NOT_CONFIGURED: '请填写并保存 API 地址和模型名称',
          RESUME_AI_TIMEOUT: '模型响应超时，可稍后重试', INVALID_MODEL_JSON: '模型没有返回有效的结构化数据，可重试或更换模型',
          RESUME_AI_NETWORK_ERROR: '无法连接模型服务，请检查 API 地址与网络', RESUME_AI_PERMISSION_DENIED: '浏览器尚未授予该模型域名的访问权限',
          'HTTP 401': 'API 密钥无效或未提供，请检查密钥', 'HTTP 403': '模型服务拒绝访问，请检查账号和模型权限', 'HTTP 429': '请求超过服务限额，请检查额度或稍后重试' };
        setResumeAiNotice(`AI 解析失败：${friendly[reason] ?? reason}。已提取的本地结果仍保留。`);
      }
    } catch {
      if (revision === parseRevision.current) setResumeAiNotice('AI 解析请求未完成，请检查模型配置后重试。本地结果仍保留。');
    } finally {
      if (revision === parseRevision.current) setExtracting(false);
    }
  }, [parsedSource, resumeAiConfig, resumeAiDirty]);

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
    const sourceRevision = parseRevision.current;
    const [info, response, history, stored] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_RESUME_STATUS' }) as Promise<ResumeStatusInfo>,
      chrome.runtime.sendMessage({ type: 'GET_COMPILED_RESUME' }) as Promise<CompiledResumeResponse>,
      chrome.runtime.sendMessage({ type: 'LIST_RESUME_VERSIONS' }) as Promise<{ versions?: ResumeVersionInfo[] }>, loadAttachment(),
    ]);
    if (revision !== resumeLoadRevision.current) return;
    const document = (response?.document as CompiledResume | null) ?? null;
    setStatus(info); setCompiled(document);
    if (sourceRevision === parseRevision.current) {
      setReviewFacts(document?.facts ?? null);
      setAttachmentName(stored?.name ?? '');
    }
    setVersions(history?.versions ?? []);
  }, []);

  useEffect(() => {
    void refresh();
    void loadCorrections();
    void loadJdContexts();
    void loadLlmConfig();
    void loadResumeAiConfig();
  }, [refresh, loadCorrections, loadJdContexts, loadLlmConfig, loadResumeAiConfig]);

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
    const revision = ++parseRevision.current;
    setParsing(false); setExtracting(false); setParsedSource(null); setParseStats(null);
    setParseJson(''); setResumeAiNotice(''); setExtractionWarnings([]);
    setParseNotice('附件已选择，点击“解析为简历”提取信息。');
    const bytes = await file.arrayBuffer();
    if (revision !== parseRevision.current) return;
    await saveAttachment({
      name: file.name,
      type: file.type !== '' ? file.type : 'application/pdf',
      size: file.size,
      bytes,
      savedAt: Date.now(),
    });
    if (revision !== parseRevision.current) return;
    setAttachmentName(file.name);
    setUploadNotice(`已保存附件：${file.name}（${Math.max(1, Math.round(file.size / 1024))} KB）`);
  }, []);

  const parseAttachment = useCallback(async (useAi: boolean = false) => {
    const revision = ++parseRevision.current;
    setExtracting(false);
    setParsedSource(null);
    setResumeAiNotice(''); setExtractionWarnings([]);
    setParsing(true);
    try {
    const stored = await loadAttachment();
    if (revision !== parseRevision.current) return;
    if (stored === null) {
      setParseNotice('请先选择 PDF 附件');
      return;
    }
    setParsing(true);
    setParseStats(null);
    setParseJson('');
    setParseNotice('正在本地解析 PDF（不上传任何数据）…');
    const textResult = await extractPdfText(stored.bytes);
    if (revision !== parseRevision.current) return;
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
    const parsed = extractResumeFacts(textResult.text, Date.now(), {
      ...(textResult.lines !== undefined ? { lines: textResult.lines } : {}),
      pageCount: textResult.pageCount,
      ...(textResult.layout !== undefined ? { layout: textResult.layout } : {}),
    });
    setParseStats(parsed.stats);
    setParseJson(JSON.stringify(parsed.facts, null, 2));
    setReviewFacts(parsed.facts);
    const source = {
      text: textResult.lines?.length ? textResult.lines.map((line, index, lines) =>
        `${index === 0 || lines[index - 1]?.page !== line.page ? `[第 ${line.page} 页]\n` : ''}${line.text}`).join('\n') : textResult.text,
      pageCount: textResult.pageCount,
      ...(textResult.layout !== undefined ? { layout: textResult.layout } : {}),
    };
    setParsedSource(source);
    setParseNotice(
      `已提取 ${textResult.pageCount} 页文字并生成本地解析结果。可点击“AI 辅助解析”进一步识别，再到下方核对信息。`,
    );
    if (useAi) { setParsing(false); await extractWithResumeAi(source); }
    } catch {
      if (revision === parseRevision.current) setParseNotice('读取或解析附件失败，请重新选择有效的 PDF 后重试。');
    } finally {
      if (revision === parseRevision.current) setParsing(false);
    }
  }, [extractWithResumeAi]);

  const reparseText = useCallback(() => {
    if (!parsedSource?.text.trim()) return;
    parseRevision.current++; setExtracting(false);
    const parsed = extractResumeFacts(parsedSource.text.replace(/^\[第 \d+ 页\]\s*$/gm, ''));
    setReviewFacts(parsed.facts); setParseJson(JSON.stringify(parsed.facts, null, 2)); setParseStats(parsed.stats);
    setParseNotice('已按修改后的原文重新解析，请核对下方信息。');
    setResumeAiNotice(''); setExtractionWarnings([]);
  }, [parsedSource]);

  const saveReview = useCallback(async () => {
    if (reviewFacts === null) {
      setReviewNotice('没有可保存的审核结果');
      return;
    }
    setReviewBusy(true);
    try {
      const result = (await chrome.runtime.sendMessage({ type: parseStats !== null ? 'IMPORT_RESUME' : 'SAVE_RESUME_REVIEW', draft: true, facts: reviewFacts, label: versionLabel })) as {
        ok: boolean;
        error?: string;
      };
      if (result?.ok === true) {
        const counts = reviewSummary(reviewFacts);
        const message = `已保存${counts.pending ? '为待审核草稿' : '到简历'}：已确认 ${counts.confirmed} 项，待核对 ${counts.pending} 项。仅已确认的信息用于自动填写。`;
        setReviewNotice(message); setParseNotice(message); setParseStats(null);
        await refresh();
      } else {
        setReviewNotice(`保存失败：${result?.error ?? '未知错误'}`);
      }
    } finally {
      setReviewBusy(false);
    }
  }, [reviewFacts, refresh, parseStats, versionLabel]);

  const cancelParse = useCallback(() => {
    parseRevision.current++; setExtracting(false); setParsing(false);
    setParseStats(null);
    setParseJson('');
    setReviewFacts(compiled?.facts ?? null);
    setParsedSource(null);
    setParseNotice('已取消本次解析结果');
  }, [compiled]);

  const changeReviewFacts = useCallback((next: ResumeFactsDocument) => {
    setReviewFacts(next);
    setParseJson(JSON.stringify(next, null, 2));
    setReviewNotice('');
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
      <header className="workbench-header"><span className="workbench-brand">ApplyFill</span><h1>把简历变成可直接填写的资料</h1>
        <p>导入简历 → AI 提取信息 → 对照原文核对 → 保存并开始填写</p></header>
      <div className="card resume-import-card">
        <h2>1. 导入你的简历</h2>
        <p className="import-description">选择 PDF，让 AI 整理个人信息和每段经历，再对照原文核对。没有模型配置时也可使用本地解析。</p>
        <input
          data-testid="attachment-input"
          type="file"
          accept=".pdf,application/pdf"
          disabled={parsing || extracting}
          onChange={(event) => void pickAttachment(event)}
        />
        <div style={{ marginTop: 10 }}>
          <button data-testid="parse-with-ai" className="primary"
            disabled={parsing || extracting || !attachmentName || resumeAiDirty || resumeAiConfig?.mode !== 'cloud' || !resumeAiConfig.enabled || !resumeAiConfig.model || resumeAiConfig.authorizedOrigin !== resumeAiOriginOf(resumeAiConfig.baseUrl)}
            onClick={() => void parseAttachment(true)}>
            {extracting ? 'AI 正在识别信息…' : parsing ? '正在读取 PDF…' : 'AI 解析简历'}
          </button>
          <button data-testid="parse-attachment" disabled={parsing || extracting} onClick={() => void parseAttachment()}>
            {parsing ? '正在读取…' : '仅本地解析'}
          </button>
          <span style={{ marginLeft: 10, fontSize: 13 }}>
            {attachmentName === '' ? '未选择附件' : `当前附件：${attachmentName}`}
          </span>
        </div>
        <p className="import-ai-state">{resumeAiDirty ? 'API 设置尚未保存，请先保存并授权。' : resumeAiConfig?.mode === 'cloud' && resumeAiConfig.enabled
          ? `AI 解析将把这份简历的文字发送到 ${resumeAiOriginOf(resumeAiConfig.baseUrl) ?? '你配置的模型服务'}。`
          : '使用 AI 解析前，先填写 API 地址、密钥和模型并授权。'} <a href="#resume-ai-settings"
            onClick={() => document.getElementById('resume-ai-settings')?.setAttribute('open', '')}>配置 AI 解析服务</a></p>
        {resumeAiNotice ? <p className="notice" data-testid="resume-ai-notice" role="status">{resumeAiNotice}</p> : null}
        {extractionWarnings.length ? <details className="parse-warnings" open><summary>AI 解析提示（{extractionWarnings.length}）</summary>
          <ul data-testid="resume-ai-warnings">{extractionWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details> : null}
        {parseNotice !== '' ? (
          <p className="notice" data-testid="parse-notice">
            {parseNotice}
          </p>
        ) : null}
        {parseStats !== null ? (
          <div data-testid="parse-preview" style={{ marginTop: 10 }}>
            <p style={{ fontSize: 13 }} data-testid="parse-stats">
              个人信息 {parseStats.basic.length} 项 · 教育经历 {parseStats.education} 段 · 工作/实习{' '}
              {parseStats.work} 段 · 项目经历 {parseStats.projects} 段 · 技能/证书 {parseStats.skills} 项
            </p>
            {parseStats.uncertain.length > 0 ? (
              <details className="parse-warnings" open><summary>未归类原文或解析提示（{parseStats.uncertain.length}）</summary>
              <p>这些内容尚未对应到具体字段。请检查是否漏掉经历，必要时在下方补录。</p>
              <ul data-testid="parse-uncertain">
                {parseStats.uncertain.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul></details>
            ) : null}
            <details className="parse-advanced"><summary>查看解析数据（高级）</summary><textarea
              data-testid="parse-json"
              style={{ minHeight: 160, width: '100%' }}
              value={parseJson}
              spellCheck={false}
              readOnly
            /></details>
            <div style={{ marginTop: 8 }}>
              <button data-testid="parse-confirm" className="primary" disabled={reviewBusy} onClick={() => void saveReview()}>
                保存当前核对结果
              </button>
              <button data-testid="parse-cancel" onClick={cancelParse}>
                取消
              </button>
            </div>
          </div>
        ) : null}
        {parsedSource ? <details className="parse-source"><summary>查看 / 修正提取的简历原文</summary>
          <p>排版提取顺序有误时，可在这里修正文字，再重新解析。下方审核区的修改会被新的解析结果替换。</p>
          <textarea aria-label="提取的简历原文" data-testid="resume-source-text" value={parsedSource.text} disabled={extracting || parsing}
            onChange={(event) => setParsedSource({ ...parsedSource, text: event.target.value })} />
          <button type="button" disabled={extracting || parsing} onClick={reparseText}>按文字重新本地解析</button>
          <button type="button" disabled={extracting || parsing || resumeAiConfig?.mode !== 'cloud' || !resumeAiConfig.enabled}
            onClick={() => void extractWithResumeAi()}>按文字重新 AI 解析</button>
        </details> : null}
        <details className="parse-upload" open><summary>将 PDF 附件上传到招聘网站</summary>
          <p>此操作将原 PDF 作为附件交给当前招聘网站，填写资料请先完成上方解析和核对。</p>
          <button data-testid="upload-attachment" onClick={() => void uploadAttachment()}>上传附件到当前页面</button>
        </details>
        {uploadNotice !== '' ? (
          <p className="notice" data-testid="upload-notice">
            {uploadNotice}
          </p>
        ) : null}
      </div>

      <details className="card ai-settings" id="resume-ai-settings">
        <summary>配置 AI 解析服务 · API 地址、密钥和模型</summary>
        <h2>AI 简历解析设置</h2>
        <p style={{ fontSize: 13 }}>
          配置你自己的兼容 Chat Completions 的模型服务。AI 会读取简历文字（包含姓名、联系方式等），整理每段经历并返回原文出处。
          授权后由你点击“AI 解析简历”发起；选择本地解析时不发送简历内容。AI 结果仍需在下方核对。
        </p>
        <label style={{ display: 'block', fontSize: 13, marginTop: 8 }}>
          模式：
          <select
            data-testid="resume-ai-mode"
            value={resumeAiConfig?.mode ?? 'local-only'}
            onChange={(event) => {
              const mode = event.target.value === 'cloud' ? 'cloud' : 'local-only';
              patchResumeAiConfig({ mode, enabled: mode === 'cloud' ? (resumeAiConfig?.enabled ?? false) : false });
            }}
          >
            <option value="local-only">Local-Only（禁止发送简历正文）</option>
            <option value="cloud">云端解析（需授权）</option>
          </select>
        </label>
        <label style={{ display: 'block', fontSize: 13, marginTop: 8 }}>
          <input
            data-testid="resume-ai-enabled"
            type="checkbox"
            checked={resumeAiConfig?.enabled ?? false}
            disabled={resumeAiConfig?.mode !== 'cloud'}
            onChange={(event) => patchResumeAiConfig({ enabled: event.target.checked })}
          />{' '}
          允许使用 AI 解析简历文字
        </label>
        <div style={{ marginTop: 8 }}>
          <input
            data-testid="resume-ai-baseurl"
            aria-label="简历解析 API 地址"
            placeholder="Base URL（OpenAI 兼容，如 https://api.example.com/v1）"
            style={{ width: '100%' }}
            value={resumeAiConfig?.baseUrl ?? ''}
            onChange={(event) => patchResumeAiConfig({ baseUrl: event.target.value })}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <input
            data-testid="resume-ai-apikey"
            aria-label="简历解析 API Key"
            type="password"
            placeholder={resumeAiConfig?.hasApiKey === true ? 'API Key（已保存，留空保持不变）' : 'API Key（如服务端无需鉴权可留空）'}
            style={{ width: '100%' }}
            value={resumeAiApiKey}
            onChange={(event) => { setResumeAiApiKey(event.target.value); setResumeAiDirty(true); }}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <input
            data-testid="resume-ai-model"
            aria-label="简历解析模型名称"
            placeholder="模型名称"
            style={{ width: '100%' }}
            value={resumeAiConfig?.model ?? ''}
            onChange={(event) => patchResumeAiConfig({ model: event.target.value })}
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <button data-testid="resume-ai-save" className="primary" onClick={() => void saveResumeAiConfig()}>
            保存 API 设置
          </button>
          <button data-testid="resume-ai-authorize" onClick={authorizeResumeAiHost}>
            保存并授权模型服务
          </button>
          <button
            data-testid="resume-ai-extract"
            disabled={extracting || resumeAiDirty || parsedSource === null || resumeAiConfig?.mode !== 'cloud' || resumeAiConfig.enabled !== true}
            onClick={() => void extractWithResumeAi()}
          >
            {extracting ? '解析中…' : '用 AI 解析当前 PDF 原文'}
          </button>
        </div>
        <p style={{ fontSize: 12, color: '#666' }}>
          已授权域名：{resumeAiConfig?.authorizedOrigin ?? '无'} · 温度 {resumeAiConfig?.temperature ?? 0} · 超时{' '}
          {resumeAiConfig?.timeoutMs ?? 30000}ms · 重试 {resumeAiConfig?.maxRetries ?? 1} 次
        </p>
      </details>

      <ReviewPanel
        facts={reviewFacts}
        compiled={compiled}
        busy={reviewBusy || extracting || parsing}
        notice={reviewNotice}
        onChange={changeReviewFacts}
        onSave={() => void saveReview()}
      />

      <div className="card">
        <h2>高级：结构化 JSON 导入与导出</h2>
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
