import { useMemo, useState } from 'react';

import type { CompiledResume, FactReviewStatus, ResumeFactsDocument } from '@/shared/contracts/resume';
import { GROUP_LABELS, setFactReviewStatus } from '@/resume/review/facts';
import type { ReviewGroup } from '@/resume/review/facts';
import {
  addReviewEntry, editReviewField, listEditableReviewFields, needsReview, REVIEW_GROUPS,
  reviewEntryTitle, reviewFieldIssue, valueAsText,
} from '@/resume/review/editor';
import type { EditableReviewField, EntryGroup } from '@/resume/review/editor';

interface ReviewPanelProps {
  facts: ResumeFactsDocument | null;
  compiled: CompiledResume | null;
  busy: boolean;
  notice: string;
  onChange(facts: ResumeFactsDocument): void;
  onSave(): void;
}

type Filter = 'all' | 'pending' | 'attention' | 'confirmed';
const FILTERS: Array<[Filter, string]> = [['all', '全部信息'], ['attention', '需补充 / 修改'], ['pending', '待核对'], ['confirmed', '已确认']];
const STATUS_LABEL: Record<FactReviewStatus, string> = { pending: '待核对', confirmed: '已确认', rejected: '不使用' };
const ENTRY_GROUPS: EntryGroup[] = ['education', 'work', 'projects', 'skills'];

function FieldEditor({ field, facts, busy, onChange, onStatus }: {
  field: EditableReviewField;
  facts: ResumeFactsDocument;
  busy: boolean;
  onChange(facts: ResumeFactsDocument): void;
  onStatus(status: FactReviewStatus): void;
}) {
  const text = valueAsText(field.value);
  const empty = text.trim() === '';
  const issue = reviewFieldIssue(field);
  const booleanField = field.path === 'preferences.freshGraduate' || field.path === 'preferences.subscribeNotifications';
  const longText = /\.(description|responsibilities|outcomes|intro|awards|additionalInfo)$/.test(field.path);
  const evidence = field.evidence[0];
  const setValue = (raw: string | boolean): void => {
    let value: unknown = raw;
    if (field.path.endsWith('.keywords')) value = String(raw).split(/[、,，;；]+/).map((part) => part.trim()).filter(Boolean);
    if (field.path === 'preferences.expectedSalary' && raw !== '') value = Number(raw);
    onChange(editReviewField(facts, field, value));
  };
  const fieldId = `review-${field.path}`;
  return (
    <div className={`review-field ${longText ? 'review-field-wide' : ''} ${issue ? 'review-field-attention' : ''} review-${field.status}`}
      data-testid={`review-field-${field.path}`} data-review-pending={needsReview(field) ? 'true' : undefined}>
      <div className="review-field-head">
        <label htmlFor={fieldId}>{field.label}</label>
        <span className={`review-status ${empty && field.status !== 'rejected' ? 'review-status-empty' : ''}`}
          data-testid={`review-status-${field.path}`}>
          {field.status === 'rejected' ? '不使用' : empty ? field.required ? '需补充' : field.valueModified ? '已清空' : '未提取 · 可选填' : STATUS_LABEL[field.status]}
        </span>
      </div>
      {booleanField ? (
        <label className="review-boolean"><input id={fieldId} type="checkbox" disabled={busy} checked={field.value === true}
          onChange={(event) => setValue(event.target.checked)} />{field.value === true ? '是' : '否'}</label>
      ) : longText ? (
        <textarea id={fieldId} data-testid={`review-input-${field.path}`} disabled={busy} value={text}
          placeholder={`未提取到${field.label}？可以直接在这里补充。`} aria-describedby={`${fieldId}-hint`}
          onChange={(event) => setValue(event.target.value)} />
      ) : (
        <input id={fieldId} data-testid={`review-input-${field.path}`} disabled={busy} value={text}
          placeholder={/Date$/.test(field.path) ? '例如 2022-09；结束时间可填至今' : `未提取到，可手动补充${field.label}`}
          aria-describedby={`${fieldId}-hint`} onChange={(event) => setValue(event.target.value)} />
      )}
      <p id={`${fieldId}-hint`} className={`review-hint ${issue ? 'review-hint-error' : ''}`}>
        {issue ?? (field.status === 'rejected' ? '已排除，这项不会用于自动填写。' : empty ? '简历中没有的信息可保持为空，无需确认。' :
          field.status === 'confirmed' ? '已核对；保存后可用于自动填写。' : field.source === 'user' ? '你修改了这项，请检查后确认。' : '请与下面的简历原文对照，核对无误后确认。')}
      </p>
      {evidence ? (
        <div className="review-evidence" data-testid={`review-evidence-${field.path}`}>
          {field.valueModified || field.evidenceStatus === 'historical' ? <p className="review-hint-error" data-testid={`review-modified-${field.path}`}>
            {field.valueModified ? '值已修改：' : '旧版引用：'}以下引用仅保留为原始记录，不是当前值的证据。{field.originalValue !== undefined ? `原提取值：${valueAsText(field.originalValue)}` : ''}
          </p> : null}
          <span className="review-evidence-label">{field.valueModified || field.evidenceStatus === 'historical' ? '原始引用（已修改）' : '简历原文'}{evidence.page ? ` · 第 ${evidence.page} 页` : ''}{evidence.section ? ` · ${evidence.section}` : ''}</span>
          <blockquote>{evidence.text}</blockquote>
          {field.evidence.length > 1 ? <details><summary>其他关联原文（{field.evidence.length - 1}）</summary>
            {field.evidence.slice(1).map((item, index) => <blockquote key={index}>{item.page ? `第 ${item.page} 页：` : ''}{item.text}</blockquote>)}
          </details> : null}
        </div>
      ) : !empty ? <p className="review-no-evidence">没有对应原文，请对照自己的简历核对。</p> : null}
      {!empty || !field.missing ? <div className="review-actions">
        <button type="button" data-testid={`review-confirm-${field.path}`} disabled={busy || field.status === 'confirmed' || empty || !!issue}
          onClick={() => onStatus('confirmed')}>核对无误</button>
        <button type="button" data-testid={`review-reject-${field.path}`} disabled={busy || field.status === 'rejected'}
          onClick={() => onStatus('rejected')}>不使用这项</button>
        {field.status !== 'pending' ? <button type="button" disabled={busy} onClick={() => onStatus('pending')}>重新核对</button> : null}
      </div> : null}
    </div>
  );
}

export function ReviewPanel({ facts, compiled, busy, notice, onChange, onSave }: ReviewPanelProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState('');
  const [attentionPaths, setAttentionPaths] = useState<string[]>([]);
  const fields = useMemo(() => facts === null ? [] : listEditableReviewFields(facts), [facts]);
  const pending = fields.filter(needsReview);
  const attention = fields.filter((field) => reviewFieldIssue(field) !== undefined);
  const confirmed = fields.filter((field) => field.status === 'confirmed' && !reviewFieldIssue(field));
  const dirty = facts !== null && JSON.stringify(facts) !== JSON.stringify(compiled?.facts);
  const grouped = useMemo(() => {
    const groups = new Map<ReviewGroup, Map<number, EditableReviewField[]>>();
    for (const group of REVIEW_GROUPS) groups.set(group, new Map());
    for (const field of fields) {
      const entries = groups.get(field.group)!;
      const key = field.entryIndex ?? -1;
      entries.set(key, [...(entries.get(key) ?? []), field]);
    }
    return groups;
  }, [fields]);

  if (facts === null) return <section className="card review-panel review-empty" id="resume-review">
    <h2>2. 核对简历信息</h2><p>解析后，个人信息和每段经历会显示在这里，并附上原文供你对照。</p>
  </section>;

  const changeStatus = (field: EditableReviewField, status: FactReviewStatus): void => {
    try { onChange(setFactReviewStatus(facts, field.path, status)); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const confirmEntry = (entry: EditableReviewField[]): void => {
    let next = facts;
    for (const field of entry) {
      if (field.status === 'pending' && valueAsText(field.value).trim() && !reviewFieldIssue(field)) {
        next = setFactReviewStatus(next, field.path, 'confirmed');
      }
    }
    onChange(next);
  };
  const selectFilter = (next: Filter): void => {
    if (next === 'attention') setAttentionPaths(attention.map((field) => field.path));
    setFilter(next);
  };
  const visible = (field: EditableReviewField): boolean => filter === 'all' ||
    (filter === 'pending' && needsReview(field)) || (filter === 'attention' && (reviewFieldIssue(field) !== undefined ||
      (attentionPaths.includes(field.path) && field.status === 'pending'))) ||
    (filter === 'confirmed' && field.status === 'confirmed');
  const focusNext = (): void => {
    setFilter('all');
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>('[data-review-pending="true"]');
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true });
    });
  };
  return (
    <section className="card review-panel" data-testid="review-panel" id="resume-review" aria-label="核对简历信息">
      <div className="review-title-row"><div><h2>2. 核对简历信息</h2>
        <p className="review-intro">先处理橙色的缺失或异常项，再对照原文核对其他信息。确认后记得保存。</p></div>
        <button type="button" onClick={focusNext} disabled={!pending.length || busy}>定位下一项</button>
      </div>
      <div className="review-overview" data-testid="review-overview">
        <button type="button" onClick={() => selectFilter('attention')}><strong>{attention.length}</strong><span>需补充 / 修改</span></button>
        <button type="button" onClick={() => setFilter('pending')}><strong>{pending.length}</strong><span>待核对（含需补充项）</span></button>
        <button type="button" onClick={() => setFilter('confirmed')}><strong>{confirmed.length}</strong><span>已确认</span></button>
      </div>
      <p className="review-guide" data-testid="review-guide">
        {pending.length ? `还有 ${pending.length} 项需要处理。空白的可选字段不用确认；未核对或选择不使用的信息不会自动填写。` : '已无待核对项。保存后，可返回招聘页面开始填写。'}
      </p>
      {facts.migration ? <p className="review-guide" data-testid="resume-migration-notice">旧版资料已恢复为可审核草稿，原始数据已保留在迁移记录中。请补全并核对后保存。</p> : null}
      <div className="review-toolbar">
        <div className="review-filters" role="group" aria-label="筛选审核信息">{FILTERS.map(([key, label]) =>
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => selectFilter(key)}>{label}</button>)}</div>
        <nav className="review-nav" aria-label="跳转到信息分类">{REVIEW_GROUPS.filter((group) => group !== 'preferences' || grouped.get(group)!.size).map((group) =>
          <a key={group} href={`#review-section-${group}`}>{GROUP_LABELS[group]}</a>)}</nav>
      </div>
      {error ? <p className="review-error" role="alert">{error}</p> : null}
      {[...grouped.entries()].map(([group, entries]) => {
        if (group === 'preferences' && !entries.size) return null;
        const allGroupFields = [...entries.values()].flat();
        const count = allGroupFields.filter(needsReview).length;
        return <section key={group} className="review-group" id={`review-section-${group}`} data-testid={`review-group-${group}`}>
          <div className="review-group-head"><h3>{GROUP_LABELS[group]}<span>{count ? `${count} 项待处理` : entries.size ? '已处理' : '尚未提取'}</span></h3>
            {ENTRY_GROUPS.includes(group as EntryGroup) ? <button type="button" disabled={busy} data-testid={`review-add-${group}`}
              onClick={() => { setFilter('all'); onChange(addReviewEntry(facts, group as EntryGroup)); }}>＋ 补充{GROUP_LABELS[group]}</button> : group === 'basic' ?
              <button type="button" disabled={busy || !allGroupFields.some((field) => needsReview(field) && !reviewFieldIssue(field))}
                onClick={() => confirmEntry(allGroupFields)}>个人信息已核对</button> : null}
          </div>
          {!entries.size ? <p className="review-group-empty">没有提取到{GROUP_LABELS[group]}。简历中有这部分内容时，可以点击右侧按钮补录。</p> : null}
          {entries.size > 0 && !allGroupFields.some(visible) ? <p className="review-group-empty">当前筛选下没有需要处理的信息。</p> : null}
          {[...entries.entries()].map(([index, entry]) => {
            const shown = entry.filter(visible);
            if (!shown.length) return null;
            const actionable = entry.filter((field) => field.status === 'pending' && valueAsText(field.value).trim() && !reviewFieldIssue(field));
            return <article key={index} className="review-entry" data-testid={`review-entry-${group}-${index}`}>
              {index >= 0 ? <div className="review-entry-head"><div><span className="review-entry-number">{GROUP_LABELS[group]} {index + 1}</span>
                <h4>{reviewEntryTitle(group, entry, index)}</h4></div>
                <button type="button" disabled={busy || !actionable.length} data-testid={`review-confirm-group-${group}-${index}`}
                  onClick={() => confirmEntry(entry)}>本段已核对（确认 {actionable.length} 项）</button></div> : null}
              <div className="review-field-grid">{shown.map((field) => <FieldEditor key={field.path} field={field} facts={facts} busy={busy}
                onChange={onChange} onStatus={(status) => changeStatus(field, status)} />)}</div>
            </article>;
          })}
        </section>;
      })}
      <footer className="review-save-bar"><div><strong>{dirty ? '有尚未保存的修改' : '审核结果已保存'}</strong>
        <span>{confirmed.length} 项已确认，{pending.length} 项待核对。可先保存，之后继续核对。</span>
        {notice ? <p className="notice" role="status">{notice.startsWith('已保存') ? '本次核对结果已保存。' : notice}</p> : null}</div>
        <button data-testid="review-save" className="primary" disabled={busy} onClick={onSave}>{busy ? '正在保存…' : '保存到简历'}</button>
      </footer>
    </section>
  );
}
