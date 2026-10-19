import { describe, expect, it } from 'vitest';
import { isRunEvent, isRunSummary } from '@/shared/messages/validateRun';

const summary = { runId: 'run', startedAt: 1, finishedAt: 2, status: 'COMPLETED',
  counts: { scanned: 1, mapped: 1, executed: 1, verified: 1, needsManual: 0, userOverridden: 0, cancelled: 0 },
  fields: [{ fieldKey: 'field', label: '姓名', controlKind: 'text', status: 'VERIFIED', attempts: 1 }], mappingIssues: [] };

describe('run message validation', () => {
  it('accepts actual reports and rejects malformed fields, negative counts and rendered objects', () => {
    expect(isRunSummary(summary)).toBe(true);
    expect(isRunSummary({ ...summary, counts: { ...summary.counts, needsManual: -1 } })).toBe(false);
    expect(isRunSummary({ ...summary, fields: [{ ...summary.fields[0], label: { private: 'data' } }] })).toBe(false);
    expect(isRunSummary({ ...summary, recovery: { refilled: {}, reverified: 1, manual: 0 } })).toBe(false);
  });
  it('rejects unknown and cross-run events before they reach storage or ports', () => {
    expect(isRunEvent({ type: 'RUN_STARTED', runId: 'run', totalFields: 1 })).toBe(true);
    expect(isRunEvent({ type: 'FIELD_FINISHED', runId: 'run' })).toBe(false);
    expect(isRunEvent({ type: 'UNKNOWN', runId: 'run' })).toBe(false);
    expect(isRunEvent({ type: 'RUN_FINISHED', runId: 'other', summary })).toBe(false);
  });
});
