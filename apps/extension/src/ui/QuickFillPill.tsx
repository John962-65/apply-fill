import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import type { PillFieldView, QuickFillPillActions, QuickFillPillController, ResumePathOption } from '@/shared/contracts/ui';

export type { EssayDraft, PillFieldView, QuickFillPillActions, QuickFillPillController } from '@/shared/contracts/ui';

const STYLE_TEXT = `
:host { all: initial; }
.pill {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  width: 320px; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #ffffff; color: #1f2937; border: 1px solid #d1d5db;
  border-radius: 10px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
  font-size: 13px; overflow: hidden;
}
.pill-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 12px; background: #111827; color: #f9fafb; font-weight: 600;
}
.pill-header button { background: none; border: none; color: #f9fafb; cursor: pointer; font-size: 13px; }
.pill-list { max-height: 320px; overflow-y: auto; }
.pill-row { padding: 8px 12px; border-top: 1px solid #e5e7eb; }
.pill-row-label { font-weight: 600; display: flex; justify-content: space-between; gap: 8px; }
.pill-row-label button { background: none; border: none; color: #2563eb; cursor: pointer; padding: 0; font-size: 12px; }
.pill-reason { color: #b91c1c; margin: 2px 0; word-break: break-all; }
.pill-target { color: #6b7280; margin: 2px 0; word-break: break-all; }
.pill-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.pill-actions button {
  border: 1px solid #d1d5db; background: #f9fafb; border-radius: 6px;
  padding: 2px 8px; cursor: pointer; font-size: 12px;
}
.pill-actions button:hover { background: #eef2ff; }
.pill-actions select { max-width: 100%; font-size: 12px; }
.pill-essay-preview { margin-top: 6px; }
.pill-essay-preview textarea {
  width: 100%; box-sizing: border-box; font-size: 12px; font-family: inherit;
  border: 1px solid #d1d5db; border-radius: 6px; padding: 6px; resize: vertical;
}
.pill-feedback { color: #047857; font-size: 12px; margin-top: 4px; }
`;

function PillApp(props: { actions: QuickFillPillActions; fields: PillFieldView[] }): JSX.Element | null {
  const { actions, fields } = props;
  const [collapsed, setCollapsed] = useState(fields.length === 0);
  const [feedback, setFeedback] = useState('');
  const [alternativesFor, setAlternativesFor] = useState<string | undefined>(undefined);
  const [alternatives, setAlternatives] = useState<ResumePathOption[]>([]);
  const [essayFor, setEssayFor] = useState<string | undefined>(undefined);
  const [essaySource, setEssaySource] = useState('');
  const [essayText, setEssayText] = useState('');
  const [essaySources, setEssaySources] = useState<ResumePathOption[]>([]);
  const [essayPath, setEssayPath] = useState('');
  const [essayBusy, setEssayBusy] = useState(false);
  const essayRevision = useRef(0);

  useEffect(() => {
    if (fields.length > 0) {
      setCollapsed(false);
    }
  }, [fields.length]);

  const count = fields.length;
  const openAlternatives = useMemo(
    () => async (fieldKey: string) => {
      setAlternativesFor(fieldKey);
      setAlternatives(await actions.onListAlternatives(fieldKey));
    },
    [actions],
  );

  if (count === 0) {
    return null;
  }
  return (
    <div className="pill" data-testid="quickfill-pill">
      <div className="pill-header">
        <span data-testid="pill-count">需要人工处理（{count}）</span>
        <button type="button" onClick={() => setCollapsed((value) => !value)} data-testid="pill-toggle">
          {collapsed ? '展开' : '收起'}
        </button>
      </div>
      {collapsed ? null : (
        <div className="pill-list">
          {fields.map((field) => (
            <div className="pill-row" key={field.fieldKey} data-testid="pill-row">
              <div className="pill-row-label">
                <span>{field.label !== '' ? field.label : field.fieldKey}</span>
                <button type="button" onClick={() => actions.onFocusField(field.fieldKey)}>
                  定位
                </button>
              </div>
              <div className="pill-reason" data-testid="pill-reason">
                {field.reason !== '' ? field.reason : field.status}
              </div>
              {field.requiresSource === true ? null : (
                <div className="pill-target" data-testid="pill-target">
                  目标值：{field.targetPreview !== '' ? field.targetPreview : '（无）'}
                </div>
              )}
              <div className="pill-actions">
                {field.requiresSource === true ? null : (
                  <button type="button" onClick={() => actions.onRetry(field.fieldKey)} data-testid="pill-retry">
                    重试
                  </button>
                )}
                {field.requiresSource === true ? null : (
                  <button
                    type="button"
                    onClick={() => {
                      actions.onCopy(field.fieldKey);
                      setFeedback(`已复制 ${field.label !== '' ? field.label : field.fieldKey} 的目标值`);
                    }}
                    data-testid="pill-copy"
                  >
                    复制
                  </button>
                )}
                <button type="button" onClick={() => void openAlternatives(field.fieldKey)} data-testid="pill-source">
                  换来源
                </button>
                {field.essay === true ? (
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        const revision = ++essayRevision.current; setEssayBusy(true);
                        try {
                        const sources = (await actions.onListAlternatives(field.fieldKey)).filter((option) => option.path.startsWith('projections.projects[') || option.path === 'projections.introShort');
                        const path = sources.find((option) => option.path.endsWith('.full_description'))?.path ?? sources[0]?.path;
                        setEssaySources(sources); setEssayPath(path ?? '');
                        const result = await actions.onGenerateEssay(field.fieldKey, path);
                        if (result !== undefined && revision === essayRevision.current) {
                          setEssayFor(field.fieldKey);
                          setEssaySource(result.source);
                          setEssayText(result.draft);
                        }
                        } finally { if (revision === essayRevision.current) setEssayBusy(false); }
                      })();
                    }}
                    data-testid="pill-essay"
                  >
                    结合 JD 生成
                  </button>
                ) : null}
                {field.requiresSource === true ? null : (
                  <button
                    type="button"
                    onClick={() => {
                      actions.onSkip(field.fieldKey);
                      setFeedback(`已跳过 ${field.label !== '' ? field.label : field.fieldKey}`);
                    }}
                    data-testid="pill-skip"
                  >
                    跳过
                  </button>
                )}
                {field.requiresSource === true ? null : (
                  <button
                    type="button"
                    onClick={() => {
                      actions.onMarkChecked(field.fieldKey);
                      setFeedback('已标记核对，受用户保护');
                    }}
                    data-testid="pill-mark"
                  >
                    标记核对
                  </button>
                )}
                {alternativesFor === field.fieldKey ? (
                  <select
                    data-testid="pill-source-select"
                    defaultValue=""
                    onChange={(event) => {
                      if (event.target.value !== '') {
                        actions.onRemap(field.fieldKey, event.target.value);
                        setAlternativesFor(undefined);
                      }
                    }}
                  >
                    <option value="">选择其他来源…</option>
                    {alternatives.map((option) => (
                      <option key={option.path} value={option.path}>
                        {option.label}：{option.preview}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              {essayFor === field.fieldKey ? (
                <div className="pill-essay-preview" data-testid="pill-essay-preview">
                  <label>选择经历和文本切面
                    <select data-testid="pill-essay-projection" value={essayPath} onChange={(event) => {
                      const path = event.target.value; const revision = ++essayRevision.current; setEssayPath(path); setEssayBusy(true);
                      void actions.onGenerateEssay(field.fieldKey, path).then((result) => {
                        if (result && revision === essayRevision.current) { setEssaySource(result.source); setEssayText(result.draft); }
                      }).finally(() => { if (revision === essayRevision.current) setEssayBusy(false); });
                    }}>
                      {essaySources.map((option) => <option key={option.path} value={option.path}>{option.label}：{option.preview}</option>)}
                    </select>
                  </label>
                  <div className="pill-target" data-testid="pill-essay-source">
                    来源：{essaySource}
                  </div>
                  <textarea
                    data-testid="pill-essay-text"
                    rows={6}
                    disabled={essayBusy}
                    maxLength={field.maxLength}
                    value={essayText}
                    onChange={(event) => setEssayText(event.target.value)}
                  />
                  <div>{essayText.length} 字{field.maxLength === undefined ? '' : ` / 上限 ${field.maxLength} 字`}</div>
                  <div className="pill-actions">
                    <button
                      type="button"
                      disabled={essayBusy || (field.maxLength !== undefined && essayText.length > field.maxLength)}
                      onClick={() => {
                        setEssayBusy(true);
                        void actions.onApplyEssay(field.fieldKey, essayText).then((ok) => {
                          setFeedback(ok ? '草稿已写入并验证，请核对' : '写入未通过验证，请检查文本长度和页面状态');
                          if (ok) setEssayFor(undefined);
                        }).finally(() => setEssayBusy(false));
                      }}
                      data-testid="pill-essay-apply"
                    >
                      写回页面
                    </button>
                    <button type="button" onClick={() => { essayRevision.current++; setEssayFor(undefined); setEssayBusy(false); }} data-testid="pill-essay-cancel">
                      取消
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {feedback !== '' ? (
        <div className="pill-feedback" data-testid="pill-feedback">
          {feedback}
        </div>
      ) : null}
    </div>
  );
}

export function mountQuickFillPill(actions: QuickFillPillActions): QuickFillPillController {
  const host = document.createElement('div');
  host.setAttribute('data-applyfill-ui', '');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE_TEXT;
  shadow.appendChild(style);
  const container = document.createElement('div');
  shadow.appendChild(container);
  document.body.appendChild(host);
  const root: Root = createRoot(container);
  let fields: PillFieldView[] = [];
  const render = (): void => {
    root.render(<PillApp actions={actions} fields={fields} />);
  };
  render();
  return {
    setFields(next: PillFieldView[]): void {
      fields = next;
      render();
    },
    destroy(): void {
      root.unmount();
      host.remove();
    },
  };
}
