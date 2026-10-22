import { describe, expect, it } from 'vitest';
import { dispatchClickSequence, setChecked } from '@/actuator/Primitives';
import { SelectAgent } from '@/actuator/SelectAgent';
import { PortalTracker } from '@/perceptor/PortalTracker';
import { DiagnosticRecorder, MAX_FIELD_DIAGNOSTICS } from '@/runtime/DiagnosticRecorder';
import { WaveBarrier } from '@/scheduler/WaveBarrier';
import { WaveScheduler } from '@/scheduler/WaveScheduler';
import { DOMRevisionTracker } from '@/perceptor/DOMRevisionTracker';
import { ReanchorManager } from '@/identity/ReanchorManager';
import { FormInstanceRegistry } from '@/identity/FormInstanceRegistry';
import { NativeCommitPredicate } from '@/verifier/CommitPredicate';
import { completionStatus } from '@/shared/utils/runReport';
import { diagnosticReport } from '@/shared/utils/diagnosticReport';
import { isRunSummary } from '@/shared/messages/validateRun';
import type { FieldDiagnostic } from '@/shared/contracts/diagnostic';
import type { RunSummary } from '@/shared/contracts/run';
import { makeSignature, mustQuery } from './helpers';

const entry: FieldDiagnostic = { runId: 'run_test', fieldKey: 'fk2_test', label: '姓名', sectionType: 'basic',
  controlKind: 'text', wave: 'LEAF', actionStage: 'VERIFY', result: 'UNKNOWN', elapsedMs: 12 };
const summary = (): RunSummary => ({ runId: 'run_test', status: 'COMPLETED', startedAt: 1, finishedAt: 2,
  counts: { scanned: 1, mapped: 1, executed: 1, verified: 0, needsManual: 1, userOverridden: 0, cancelled: 0 }, fields: [], mappingIssues: [] });

describe('engine stability contracts', () => {
  it('same-key node replacement, value reset and option replacement are detected without added fields', () => {
    document.body.innerHTML = '<label>姓名<input name="name" value="before" /></label><label>学历<select name="degree"><option>本科</option></select></label>';
    const barrier = new WaveBarrier(document);
    const before = barrier.snapshotFields();
    document.body.innerHTML = '<label>姓名<input name="name" /></label><label>学历<select name="degree"><option>硕士</option></select></label>';
    const delta = WaveBarrier.diff(before, barrier.snapshotFields(), false);
    expect(delta.added).toEqual([]);
    expect(delta.removed).toEqual([]);
    expect(delta.replaced).toHaveLength(2);
    expect(delta.valueChanges).toHaveLength(2);
    expect(delta.optionChanges).toHaveLength(1);
    expect(delta.mutated).toBe(true);
  });

  it('revision is captured before executor mutations, including synchronous redraw', async () => {
    document.body.innerHTML = '<label>姓名<input name="name" /></label>';
    const tracker = new DOMRevisionTracker(document); tracker.start();
    const scheduler = new WaveScheduler({ getDomRevision: () => tracker.revision,
      barrier: new WaveBarrier(document, { quietWindowMs: 5, maxWaitMs: 30 }) });
    try {
      const result = await scheduler.runWave('LEAF', [], { signal: new AbortController().signal, executor: async () => {
        document.querySelector('input')!.replaceWith(document.querySelector('input')!.cloneNode()); return [];
      } });
      expect(result.summary.domChanged).toBe(true);
      expect(result.summary.domRevisionAfter).toBeGreaterThan(result.summary.domRevisionBefore!);
      expect(result.delta.replaced).toHaveLength(1);
    } finally { tracker.stop(); }
  });

  it('plugin diagnostics/UI updates do not consume DOM revision budgets', async () => {
    const tracker = new DOMRevisionTracker(document); tracker.start();
    try {
      const before = tracker.revision;
      const ui = document.createElement('div'); ui.dataset.applyfillUi = ''; document.body.append(ui);
      ui.textContent = 'changed'; await Promise.resolve();
      expect(tracker.revision).toBe(before);
    } finally { tracker.stop(); }
  });

  it('empty redrawn instances bind by unique stable identifiers, never by shared positional names', () => {
    const registry = new FormInstanceRegistry();
    for (const id of ['a', 'b']) registry.upsert(id, { sectionType: 'education', resumeEntryId: `resume-${id}`,
      witness: { auxiliary: [], stableIds: [`school-${id}`] }, topology: ['学校|text'], observedAt: 1 });
    const observations = ['b', 'a'].map((id) => ({ sectionType: 'education' as const,
      fields: [{ normalizedLabel: '学校', controlKind: 'text' as const, valueText: '', fieldName: `school-${id}` }] }));
    const result = new ReanchorManager().reanchorSection({ sectionType: 'education', observations,
      snapshots: registry.bySection('education'), availableEntryIds: ['resume-a', 'resume-b'], allocateInstanceId: () => 'new' });
    expect(result.results.map((item) => item.resumeEntryId)).toEqual(['resume-b', 'resume-a']);
    expect(result.results.every((item) => item.status === 'MATCHED')).toBe(true);
  });

  it('pointer names use PointerEvent, mouse names use MouseEvent, native click retains activation behavior', () => {
    document.body.innerHTML = '<input type="checkbox" />';
    const input = mustQuery<HTMLInputElement>('input');
    const events: Event[] = [];
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) input.addEventListener(type, (event) => events.push(event));
    dispatchClickSequence(input);
    expect(events.map((event) => event.type)).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    if (window.PointerEvent) expect(events[0]).toBeInstanceOf(window.PointerEvent);
    expect(events[1]).toBeInstanceOf(MouseEvent);
    expect(events.every((event) => !event.isTrusted)).toBe(true);
    expect(input.checked).toBe(true);
  });

  it('matching display text cannot override the empty/different authoritative business value', async () => {
    document.body.innerHTML = '<div data-combobox-root><input role="combobox" data-committed="男" value="男" /><input type="hidden" value="female" /></div>';
    const context = { fieldKey: 'gender', controlKind: 'combobox' as const, signature: makeSignature('combobox'),
      element: mustQuery<HTMLElement>('[role="combobox"]'), expectedValue: '男', expectedText: '男', signal: new AbortController().signal };
    const predicate = new NativeCommitPredicate();
    expect((await predicate.verify(context)).status).toBe('REJECTED');
    mustQuery<HTMLInputElement>('[type=hidden]').value = '';
    expect((await predicate.verify(context)).status).toBe('REJECTED');
    mustQuery<HTMLInputElement>('[type=hidden]').value = 'male';
    expect((await predicate.verify({ ...context, expectedCommitValue: 'male' })).status).toBe('CONFIRMED');
  });

  it('a checkbox rejecting synthetic clicks is never forced to a different DOM value', async () => {
    document.body.innerHTML = '<input type="checkbox" />';
    const input = mustQuery<HTMLInputElement>('input');
    input.addEventListener('click', (event) => { if (!event.isTrusted) event.preventDefault(); });
    await expect(setChecked(input, true)).rejects.toThrow('CLICK_NO_STATE_CHANGE');
    expect(input.checked).toBe(false);
  });

  it('selecting a label with a coded business value uses the clicked option identity', async () => {
    document.body.innerHTML = '<div data-combobox-root><input id="trigger" role="combobox" aria-controls="popup" /><input type="hidden" /></div>';
    const trigger = mustQuery<HTMLElement>('#trigger');
    trigger.onclick = () => {
      const popup = document.createElement('div'); popup.id = 'popup'; popup.setAttribute('role', 'listbox');
      popup.innerHTML = '<div role="option" data-value="male">男</div>';
      popup.firstElementChild!.addEventListener('click', () => { mustQuery<HTMLInputElement>('[type=hidden]').value = 'male'; popup.remove(); });
      document.body.append(popup);
    };
    const result = await new SelectAgent(new PortalTracker()).select(trigger, '男');
    expect(result.status).toBe('SELECTED'); expect(result.commitValue).toBe('male');
  });

  it('partial result survives validation and becomes complete only after manual work is resolved', () => {
    const report = summary(); report.status = completionStatus(report);
    expect(report.status).toBe('PARTIAL'); expect(isRunSummary(report)).toBe(true);
    report.counts.needsManual = 0; expect(completionStatus(report)).toBe('COMPLETED');
  });

  it('diagnostics redact values before storing; copied reports allowlist metadata without resume or API payloads', () => {
    const recorder = new DiagnosticRecorder(['张三', '13800001111', 'zhangsan@example.com']);
    recorder.record({ ...entry, label: '姓名：张三 13800001111 zhangsan@example.com', reason: 'raw error with api key' });
    recorder.record({ ...entry, label: 'apiKey sk-secret-123456789' });
    const report = { ...summary(), diagnostics: recorder.snapshot(),
      fields: [{ fieldKey: 'field', label: '姓名', controlKind: 'text' as const, status: 'VERIFIED' as const, attempts: 1, expectedValue: '张三' }] };
    const copied = diagnosticReport(report);
    for (const privateValue of ['张三', '13800001111', 'zhangsan@example.com', 'sk-secret', 'raw error']) {
      expect(JSON.stringify(recorder.snapshot())).not.toContain(privateValue);
      expect(copied).not.toContain(privateValue);
    }
    expect(JSON.parse(copied).diagnostics[0].actionStage).toBe('VERIFY');
    for (let index = 0; index < MAX_FIELD_DIAGNOSTICS; index++) recorder.record(entry);
    expect(recorder.snapshot()).toHaveLength(MAX_FIELD_DIAGNOSTICS); expect(recorder.dropped).toBe(2);
  });
});
