import { useMemo } from 'react';

import type { CompiledResume, FactReviewStatus, ResumeFactsDocument } from '@/shared/contracts/resume';
import {
  GROUP_LABELS,
  listReviewFields,
  reviewSummary,
  setFactReviewStatus,
  updateFactValue,
} from '@/resume/review/facts';
import type { ReviewField, ReviewGroup } from '@/resume/review/facts';

interface ReviewPanelProps {
  facts: ResumeFactsDocument | null;
  compiled: CompiledResume | null;
  busy: boolean;
  notice: string;
  onChange(facts: ResumeFactsDocument): void;
  onSave(): void;
}

const STATUS_LABEL: Record<FactReviewStatus, string> = {
  pending: '待确认',
  confirmed: '已确认',
  rejected: '已拒绝',
};

const STATUS_COLOR: Record<FactReviewStatus, string> = {
  pending: '#a15c00',
  confirmed: '#157347',
  rejected: '#b42318',
};

function valueAsText(value: unknown): string {
  if (Array.isArray(value)) return value.join('、');
  if (value === undefined || value === null) return '';
  return String(value);
}

function editorValueFor(field: ReviewField, raw: string): unknown {
  if (field.path.endsWith('.keywords')) {
    return raw.split(/[、,，;；]+/).map((part) => part.trim()).filter((part) => part !== '');
  }
  if (field.path === 'preferences.expectedSalary') {
    const number = Number(raw);
    return Number.isFinite(number) ? number : 0;
  }
  if (field.path === 'preferences.freshGraduate' || field.path === 'preferences.subscribeNotifications') {
    return raw === 'true';
  }
  return raw;
}

function statusFor(field: ReviewField, compiled: CompiledResume | null): string {
  if (field.status !== 'confirmed') return '';
  const report = compiled?.fillability?.fields.find((item) => item.path === field.path);
  if (report === undefined) return '';
  return report.fillable ? '可填写' : `不可填写：${report.reason ?? 'UNKNOWN'}`;
}

function FieldEditor({
  field,
  facts,
  compiled,
  onChange,
  onStatus,
}: {
  field: ReviewField;
  facts: ResumeFactsDocument;
  compiled: CompiledResume | null;
  onChange(facts: ResumeFactsDocument): void;
  onStatus(status: FactReviewStatus): void;
}) {
  const setValue = (value: unknown): void => {
    onChange(updateFactValue(facts, field.path, value));
  };
  const booleanField = field.path === 'preferences.freshGraduate' || field.path === 'preferences.subscribeNotifications';
  const longTextField = /\.(description|responsibilities|outcomes|intro|awards|additionalInfo)$/.test(field.path);
  const fillability = statusFor(field, compiled);
  return (
    <div className="review-field" data-testid={`review-field-${field.path}`}>
      <div className="review-field-head">
        <label htmlFor={`review-${field.path}`}>{field.label}{field.required ? ' *' : ''}</label>
        <span className="review-status" style={{ color: STATUS_COLOR[field.status] }} data-testid={`review-status-${field.path}`}>
          {STATUS_LABEL[field.status]}
        </span>
        {fillability !== '' ? <span className="review-fillability">{fillability}</span> : null}
      </div>
      {booleanField ? (
        <input
          id={`review-${field.path}`}
          type="checkbox"
          checked={field.value === true}
          onChange={(event) => setValue(event.target.checked)}
        />
      ) : longTextField ? (
        <textarea
          id={`review-${field.path}`}
          data-testid={`review-input-${field.path}`}
          value={valueAsText(field.value)}
          onChange={(event) => setValue(event.target.value)}
        />
      ) : (
        <input
          id={`review-${field.path}`}
          data-testid={`review-input-${field.path}`}
          value={valueAsText(field.value)}
          onChange={(event) => setValue(editorValueFor(field, event.target.value))}
        />
      )}
      <div className="review-actions">
        <button
          type="button"
          data-testid={`review-confirm-${field.path}`}
          disabled={field.status === 'confirmed' || valueAsText(field.value).trim() === ''}
          onClick={() => onStatus('confirmed')}
        >
          确认
        </button>
        <button
          type="button"
          data-testid={`review-reject-${field.path}`}
          disabled={field.status === 'rejected'}
          onClick={() => onStatus('rejected')}
        >
          拒绝
        </button>
        {field.status !== 'pending' ? (
          <button type="button" onClick={() => onStatus('pending')}>恢复待确认</button>
        ) : null}
      </div>
      <details className="review-evidence" data-testid={`review-evidence-${field.path}`}>
        <summary>查看原文证据（{field.evidence.length}）</summary>
        {field.evidence.length === 0 ? <p>无原文证据。请人工补全后确认。</p> : (
          <ul>
            {field.evidence.map((evidence, index) => (
              <li key={`${field.path}-${index}`}>
                {evidence.page !== undefined ? `第 ${evidence.page} 页 · ` : ''}
                {evidence.section !== undefined ? `${evidence.section} · ` : ''}
                「{evidence.text}」
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

export function ReviewPanel({ facts, compiled, busy, notice, onChange, onSave }: ReviewPanelProps) {
  const fields = useMemo(() => (facts === null ? [] : listReviewFields(facts)), [facts]);
  const summary = useMemo(() => (facts === null ? null : reviewSummary(facts)), [facts]);
  const grouped = useMemo(() => {
    const groups = new Map<ReviewGroup, Map<number, ReviewField[]>>();
    for (const field of fields) {
      const entries = groups.get(field.group) ?? new Map<number, ReviewField[]>();
      const key = field.entryIndex ?? -1;
      const list = entries.get(key) ?? [];
      list.push(field);
      entries.set(key, list);
      groups.set(field.group, entries);
    }
    return groups;
  }, [fields]);

  if (facts === null) {
    return (
      <div className="card">
        <h2>字段级审核</h2>
        <p>导入 PDF 或 JSON 后，可在此逐字段确认、编辑或拒绝；未确认字段不会进入自动填写计划。</p>
      </div>
    );
  }

  const changeStatus = (path: string, status: FactReviewStatus, next: ResumeFactsDocument): void => {
    try {
      onChange(setFactReviewStatus(next, path, status));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  };

  const confirmGroup = (groupFields: ReviewField[]): void => {
    let next = facts;
    for (const field of groupFields) {
      if (field.status !== 'pending' || valueAsText(field.value).trim() === '') continue;
      next = setFactReviewStatus(next, field.path, 'confirmed');
    }
    onChange(next);
  };

  return (
    <div className="card" data-testid="review-panel">
      <h2>字段级审核（原件证据对齐）</h2>
      <p style={{ fontSize: 13 }}>
        已确认 {summary?.confirmed ?? 0} · 待确认 {summary?.pending ?? 0} · 已拒绝 {summary?.rejected ?? 0}。
        只有已确认且可填写验证通过的字段会进入 Planner。拒绝的字段会保留在草稿中，但不会被填写。
      </p>
      {compiled?.fillability !== undefined ? (
        <p style={{ fontSize: 12, color: compiled.fillability.ok ? '#157347' : '#a15c00' }} data-testid="fillability-summary">
          可填写性：{compiled.fillability.ok ? '通过' : `存在 ${compiled.fillability.issues.length} 个问题`} ·
          已确认 {compiled.fillability.confirmedFields} · 待确认 {compiled.fillability.pendingFields} ·
          已拒绝 {compiled.fillability.rejectedFields}
        </p>
      ) : null}
      {notice !== '' ? <p className="notice">{notice}</p> : null}
      <div style={{ marginTop: 8 }}>
        <button data-testid="review-save" className="primary" disabled={busy} onClick={onSave}>
          保存审核结果
        </button>
      </div>
      {[...grouped.entries()].map(([group, entries]) => (
        <section key={group} className="review-group" data-testid={`review-group-${group}`}>
          <h3>{GROUP_LABELS[group]}</h3>
          {[...entries.entries()].map(([entryIndex, groupFields]) => (
            <div key={`${group}-${entryIndex}`} className="review-entry">
              {entryIndex >= 0 ? (
                <div className="review-entry-head">
                  <strong>{GROUP_LABELS[group]} {entryIndex + 1}</strong>
                  <button
                    type="button"
                    data-testid={`review-confirm-group-${group}-${entryIndex}`}
                    onClick={() => confirmGroup(groupFields)}
                  >
                    确认本段全部非空字段
                  </button>
                </div>
              ) : null}
              {groupFields.map((field) => (
                <FieldEditor
                  key={field.path}
                  field={field}
                  facts={facts}
                  compiled={compiled}
                  onChange={onChange}
                  onStatus={(status) => changeStatus(field.path, status, facts)}
                />
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
