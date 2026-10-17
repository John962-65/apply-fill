import { useCallback, useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';

import { ApplicationContextStore } from '@/jd/ApplicationContext';
import type { ApplicationContext } from '@/jd/ApplicationContext';
import { UserCorrectionStore } from '@/memory/UserCorrectionStore';
import type { UserCorrectionRecord } from '@/memory/UserCorrectionStore';
import { loadAttachment, saveAttachment } from '@/resume/storage/attachmentStore';
import type {
  LlmConfigResponse,
  LlmConfigView,
  LlmProviderConfig,
  LlmTestConnectionResponse,
} from '@/shared/contracts/llm';
import type { CompiledResume } from '@/shared/contracts/resume';
import type { CompiledResumeResponse, ResumeStatusInfo, UploadAttachmentResponse } from '@/shared/messages/protocol';
import { createSampleResumeFacts } from '@/shared/samples/sampleResume';

const CORRECTION_KIND_LABELS: Record<UserCorrectionRecord['kind'], string> = {
  REMAP: '来源修正',
  MANUAL_EDIT: '手动完成',
};

export function App() {
  const [json, setJson] = useState('');
  const [notice, setNotice] = useState('');
  const [status, setStatus] = useState<ResumeStatusInfo | null>(null);
  const [compiled, setCompiled] = useState<CompiledResume | null>(null);
  const [attachmentName, setAttachmentName] = useState('');
  const [uploadNotice, setUploadNotice] = useState('');
  const [corrections, setCorrections] = useState<UserCorrectionRecord[]>([]);
  const [jdContexts, setJdContexts] = useState<ApplicationContext[]>([]);
  const [llmConfig, setLlmConfig] = useState<LlmConfigView | null>(null);
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmNotice, setLlmNotice] = useState('');

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

  const testLlmConnection = useCallback(async () => {
    setLlmNotice('正在测试连接…');
    const response = (await chrome.runtime.sendMessage({ type: 'LLM_TEST_CONNECTION' })) as LlmTestConnectionResponse;
    setLlmNotice(
      response?.ok === true
        ? `连接成功：${response.message ?? ''}`
        : `连接失败：${response.message ?? '未知错误'}`,
    );
  }, []);

  const loadJdContexts = useCallback(async () => {
    const stored = await chrome.storage.session.get(ApplicationContextStore.STORAGE_KEY);
    const store = new ApplicationContextStore();
    store.loadFromJSON(stored[ApplicationContextStore.STORAGE_KEY]);
    setJdContexts(
      store
        .toJSON()
        .entries.map(([, context]) => context)
        .sort((a, b) => b.capturedAt - a.capturedAt),
    );
  }, []);

  const loadCorrections = useCallback(async () => {
    const stored = await chrome.storage.local.get(UserCorrectionStore.STORAGE_KEY);
    const store = new UserCorrectionStore();
    store.loadFromJSON(stored[UserCorrectionStore.STORAGE_KEY]);
    setCorrections(store.list().slice().reverse());
  }, []);

  useEffect(() => {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ): void => {
      if (area === 'local' && changes[UserCorrectionStore.STORAGE_KEY] !== undefined) {
        void loadCorrections();
      }
      if (area === 'session' && changes[ApplicationContextStore.STORAGE_KEY] !== undefined) {
        void loadJdContexts();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [loadCorrections, loadJdContexts]);

  const dismissCorrection = useCallback(
    async (id: string) => {
      const stored = await chrome.storage.local.get(UserCorrectionStore.STORAGE_KEY);
      const store = new UserCorrectionStore();
      store.loadFromJSON(stored[UserCorrectionStore.STORAGE_KEY]);
      store.remove(id);
      await chrome.storage.local.set({ [UserCorrectionStore.STORAGE_KEY]: store.toJSON() });
      await loadCorrections();
    },
    [loadCorrections],
  );

  const clearCorrections = useCallback(async () => {
    await chrome.storage.local.remove(UserCorrectionStore.STORAGE_KEY);
    await loadCorrections();
  }, [loadCorrections]);

  const refresh = useCallback(async () => {
    const info = (await chrome.runtime.sendMessage({ type: 'GET_RESUME_STATUS' })) as ResumeStatusInfo;
    setStatus(info);
    const response = (await chrome.runtime.sendMessage({ type: 'GET_COMPILED_RESUME' })) as CompiledResumeResponse;
    setCompiled((response?.document as CompiledResume | null) ?? null);
    const stored = await loadAttachment();
    setAttachmentName(stored?.name ?? '');
  }, []);

  useEffect(() => {
    void refresh();
    void loadCorrections();
    void loadJdContexts();
    void loadLlmConfig();
  }, [refresh, loadCorrections, loadJdContexts, loadLlmConfig]);

  const importResume = useCallback(async () => {
    try {
      const facts = JSON.parse(json) as unknown;
      const result = (await chrome.runtime.sendMessage({ type: 'IMPORT_RESUME', facts })) as {
        ok: boolean;
        error?: string;
      };
      if (result?.ok === true) {
        setNotice('导入并编译成功');
        await refresh();
      } else {
        setNotice(`导入失败：${result?.error ?? '未知错误'}`);
      }
    } catch (error) {
      setNotice(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [json, refresh]);

  const clearResume = useCallback(async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_RESUME' });
    setNotice('已清空简历数据');
    await refresh();
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
        <textarea value={json} onChange={(event) => setJson(event.target.value)} spellCheck={false} />
        <div style={{ marginTop: 10 }}>
          <button className="primary" onClick={() => void importResume()}>
            导入并编译
          </button>
          <button onClick={loadSample}>载入示例简历</button>
          <button onClick={() => void clearResume()}>清空简历</button>
          <button onClick={() => void refresh()}>刷新状态</button>
          <button onClick={exportCompiled}>导出已编译 JSON</button>
        </div>
        {notice !== '' ? <p className="notice">{notice}</p> : null}
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
          <span style={{ marginLeft: 10, fontSize: 13 }}>
            {attachmentName === '' ? '未选择附件' : `当前附件：${attachmentName}`}
          </span>
        </div>
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
        {jdContexts.length === 0 ? (
          <p style={{ fontSize: 13 }} data-testid="jd-empty">
            暂无岗位上下文（在含职位描述的页面执行一次填写后缓存）
          </p>
        ) : (
          jdContexts.map((context) => (
            <div key={context.host} data-testid="jd-context" style={{ fontSize: 13, marginBottom: 8 }}>
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
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h2>AI 模型设置（云端语义辅助 · LLM）</h2>
        <p style={{ fontSize: 13 }}>
          当本地规则与缓存无法识别表单字段时，可选择把字段标签等元信息（不含任何简历内容）发送到你自己配置的
          OpenAI 兼容接口，由模型返回简历路径建议。默认关闭；API Key 仅保存在本机浏览器存储中，不会上传到任何其他服务器。
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
