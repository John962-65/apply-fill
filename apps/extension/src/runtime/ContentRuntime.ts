import { CascaderWalker } from '@/actuator/CascaderWalker';
import { DateAgent } from '@/actuator/DateAgent';
import { FieldExecutionEngine } from '@/actuator/FieldExecutionEngine';
import { FileUploadAgent } from '@/actuator/FileUploadAgent';
import type { ExecutableField } from '@/actuator/FieldExecutionEngine';
import { SelectAgent } from '@/actuator/SelectAgent';
import { GuardRegistry } from '@/guard/GuardRegistry';
import { UserInteractionObserver } from '@/guard/UserInteractionObserver';
import {
  buildFieldIdentity,
  buildTopology,
  extractWitness,
  FormInstanceRegistry,
  ReanchorManager,
} from '@/identity';
import {
  distillElements,
  distillField,
  distillScopedElements,
  DOMRevisionTracker,
  expandSection,
  FORM_CONTROL_SELECTOR,
  isFormElement,
  PortalTracker,
  readFieldValueText,
  readStableAttribute,
  scanFormElements,
  scanRepeatableSections,
} from '@/perceptor';
import type { DistilledElement, ScannedSection } from '@/perceptor';
import { formatForField } from '@/formatter';
import { listResumeValuePaths } from '@/resume/compiler/paths';
import type { ResumePathOption } from '@/resume/compiler/paths';
import { BatchLLMRouter, FingerprintCache, resolveResumePath } from '@/router';
import type { RoutedProposal, UnmappedFieldRef } from '@/router';
import { ExecutionMutex } from '@/scheduler/ExecutionMutex';
import { RuntimeDependencyRegistry } from '@/scheduler/RuntimeDependencyRegistry';
import { WaveBarrier } from '@/scheduler/WaveBarrier';
import { WaveScheduler } from '@/scheduler/WaveScheduler';
import type { CompiledResume } from '@/shared/contracts/resume';
import type { ControlKind, FieldExecutionResult, MappingIssue, SectionType } from '@/shared/contracts/field';
import type { InstanceObservation, InstanceReport, ObservationField, ReanchorStatus } from '@/shared/contracts/reanchor';
import type { RunEvent, RunSummary } from '@/shared/contracts/run';
import type { ExecutionWave, WaveExecutionSummary } from '@/shared/contracts/scheduler';
import { LLM_DISABLED_ERROR, LLM_NOT_CONFIGURED_ERROR } from '@/shared/contracts/llm';
import type { LlmRouteResponse } from '@/shared/contracts/llm';
import { sendToBackground } from '@/shared/messages/client';
import { isTabMessage } from '@/shared/messages/protocol';
import type { AttachmentInfo, AutofillRunResponse, SimpleAck, UploadAttachmentResponse } from '@/shared/messages/protocol';
import { createId } from '@/shared/utils/id';
import { ApplicationContextStore } from '@/jd/ApplicationContext';
import type { ApplicationContext } from '@/jd/ApplicationContext';
import { generateEssayDraft } from '@/jd/EssayGenerator';
import type { EssayProjection } from '@/jd/EssayGenerator';
import { sniffJobDescription } from '@/jd/JDSniffer';
import { MappingMemory } from '@/memory/MappingMemory';
import { UserCorrectionStore } from '@/memory/UserCorrectionStore';
import { DirtyChecker, isDirtyCheckable, observedValueMatches } from '@/verifier/DirtyChecker';
import type { DirtyCandidate } from '@/verifier/DirtyChecker';
import { RecoveryPlanner } from '@/verifier/RecoveryPlanner';
import type { RecoveryCandidate } from '@/verifier/RecoveryPlanner';
import { NativeCommitPredicate } from '@/verifier/CommitPredicate';
import { FieldVerifier } from '@/verifier/FieldVerifier';
import { detectValidationError } from '@/verifier/ValidationErrorDetector';
import { mountQuickFillPill } from '@/ui/QuickFillPill';
import type { EssayDraft, PillFieldView, QuickFillPillActions, QuickFillPillController } from '@/ui/QuickFillPill';

import { PauseGate } from './PauseGate';
import { buildExecutionPlan } from './planner';
import type { ExecutionPlan, ScopedInstanceInput } from './planner';
import { StepObserver } from './StepObserver';

interface ActiveRun {
  runId: string;
  controller: AbortController;
  pauseGate: PauseGate;
}

interface ContainerRole {
  sectionType: SectionType;
  instanceId: string;
}

const SCOPED_SECTION_TYPES = new Set<SectionType>(['education', 'project']);
const CACHE_STORAGE_KEY = 'applyfill.fingerprintCache';
const MAX_RECONCILE_PASSES = 2;
const MAX_STEP_TRANSITIONS = 5;
const STEP_SETTLE_MS = 400;
const USER_EDIT_PRECURSOR_WINDOW_MS = 1500;

interface StepIterationOutcome {
  results: FieldExecutionResult[];
  waves: WaveExecutionSummary[];
  cycles: Array<{ sourceFieldKey: string; targetFieldKey: string }>;
  issues: MappingIssue[];
  instances: InstanceReport[];
  scanned: number;
  plan: ExecutionPlan;
}

function entryIdsOf(compiled: CompiledResume, sectionType: SectionType): string[] {
  if (sectionType === 'education') {
    return compiled.normalized.education.map((entry) => entry.id);
  }
  if (sectionType === 'project') {
    return compiled.normalized.projects.map((entry) => entry.id);
  }
  return [];
}

function targetCountOf(compiled: CompiledResume, sectionType: SectionType): number {
  return entryIdsOf(compiled, sectionType).length;
}

function toObservation(sectionType: SectionType, items: DistilledElement[]): InstanceObservation {
  const fields: ObservationField[] = items.map((item) => {
    const observation: ObservationField = {
      normalizedLabel: item.field.descriptor.normalizedLabel,
      controlKind: item.field.controlKind,
      valueText: readFieldValueText(item.element),
    };
    const fieldName = item.field.descriptor.disambiguator?.fieldName;
    if (fieldName !== undefined && fieldName !== '') {
      observation.fieldName = fieldName;
    }
    const stableAttribute = readStableAttribute(item.element);
    if (stableAttribute !== undefined) {
      observation.stableAttribute = stableAttribute;
    }
    return observation;
  });
  return { sectionType, fields };
}

function reportStatusOf(status: ReanchorStatus): InstanceReport['status'] {
  return status === 'MATCHED' ? 'MATCHED' : status === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'NEW_INSTANCE';
}

export class ContentRuntime {
  private readonly registry = new GuardRegistry();
  private readonly engine: FieldExecutionEngine;
  private readonly observer: UserInteractionObserver;
  private readonly elementByKey = new Map<string, HTMLElement>();
  private readonly keyByElement = new WeakMap<Element, string>();
  private readonly containerRoles = new WeakMap<Element, ContainerRole>();
  private readonly instanceRegistry = new FormInstanceRegistry();
  private readonly reanchorManager = new ReanchorManager();
  private readonly revisionTracker = new DOMRevisionTracker(document);
  private readonly fingerprintCache = new FingerprintCache();
  private readonly mappingMemory = new MappingMemory();
  private readonly userCorrections = new UserCorrectionStore();
  private readonly dependencyRegistry = new RuntimeDependencyRegistry();
  private readonly waveScheduler: WaveScheduler;
  private readonly dirtyChecker = new DirtyChecker();
  private readonly recoveryPlanner = new RecoveryPlanner();
  private lastCompiled: CompiledResume | null = null;
  private lastPlan: ExecutionPlan | null = null;
  private lastSummary: RunSummary | null = null;
  private pill: QuickFillPillController | null = null;
  private readonly stepObserver = new StepObserver(document);
  private readonly fileUploadAgent = new FileUploadAgent();
  private readonly llmRouter: BatchLLMRouter;
  private llmProposals = new Map<string, RoutedProposal>();
  private llmInfo: NonNullable<RunSummary['llm']> | null = null;
  private readonly lastUserInteractions = new WeakMap<Element, number>();
  private activeRun: ActiveRun | null = null;
  private started = false;

  constructor() {
    const verifier = new FieldVerifier(new NativeCommitPredicate());
    const portalTracker = new PortalTracker();
    const selectAgent = new SelectAgent(portalTracker);
    this.engine = new FieldExecutionEngine(this.registry, {
      resolveElement: (fieldKey) => this.resolveElement(fieldKey),
      verifyField: (context) => verifier.verify(context),
      selectAgent,
      cascaderWalker: new CascaderWalker(portalTracker),
      dateAgent: new DateAgent(portalTracker, selectAgent),
    });
    this.waveScheduler = new WaveScheduler({
      barrier: new WaveBarrier(document),
      registry: this.dependencyRegistry,
      mutex: new ExecutionMutex(),
    });
    this.observer = new UserInteractionObserver({
      resolveFieldKey: (target) => this.resolveFieldKey(target),
      onUserEdit: (fieldKey, event, target) => this.handleUserEdit(fieldKey, event, target),
    });
    this.llmRouter = new BatchLLMRouter(async (batch) => {
      const response = await sendToBackground<LlmRouteResponse>({
        type: 'LLM_ROUTE_FIELDS',
        fields: batch.map((field) => ({
          fieldKey: field.fieldKey,
          label: field.label,
          controlKind: field.controlKind,
          sectionType: field.sectionType,
          ...(field.instanceIndex !== undefined ? { instanceIndex: field.instanceIndex } : {}),
        })),
      });
      if (response?.ok === true) {
        return response.proposals ?? [];
      }
      if (response?.error === LLM_DISABLED_ERROR || response?.error === LLM_NOT_CONFIGURED_ERROR) {
        return [];
      }
      throw new Error(response?.error ?? 'LLM_ROUTE_FAILED');
    });
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.revisionTracker.start();
    this.observer.start(document);
    this.stepObserver.start();
    try {
      void chrome.runtime
        .sendMessage({ type: 'FRAME_HELLO', url: location.href, title: document.title })
        .catch(() => undefined);
    } catch {
      void 0;
    }
    chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (!isTabMessage(message)) {
        return undefined;
      }
      switch (message.type) {
        case 'PING':
          sendResponse({ ok: true, url: location.href, title: document.title } satisfies SimpleAck);
          return undefined;
        case 'RUN_AUTOFILL':
        case 'RUN_AUTOFILL_FRAME':
          this.handleRunRequest(sendResponse);
          return true;
        case 'CANCEL_RUN':
          sendResponse(this.handleCancel());
          return undefined;
        case 'PAUSE_RUN':
          sendResponse(this.handlePause());
          return undefined;
        case 'RESUME_RUN':
          sendResponse(this.handleResume());
          return undefined;
        case 'UPLOAD_ATTACHMENT':
          this.handleUploadAttachment(sendResponse as (response: UploadAttachmentResponse) => void);
          return true;
        case 'RETRY_FIELD':
          void this.pillRetryField(message.fieldKey);
          sendResponse({ ok: true });
          return undefined;
        default:
          return undefined;
      }
    });
  }

  private handleUploadAttachment(sendResponse: (response: UploadAttachmentResponse) => void): void {
    void (async () => {
      try {
        const attachment = await sendToBackground<AttachmentInfo | null>({ type: 'GET_ATTACHMENT' });
        if (attachment === null || attachment === undefined) {
          sendResponse({ ok: false, status: 'NO_ATTACHMENT', message: '工作台尚未选择附件' });
          return;
        }
        const input = this.findFileInput();
        if (input === null) {
          sendResponse({ ok: false, status: 'NO_FILE_INPUT', message: '当前页面未找到可用的文件上传控件' });
          return;
        }
        const file = new File([attachment.bytes], attachment.name, { type: attachment.type });
        const result = await this.fileUploadAgent.upload(input, file);
        sendResponse({
          ok: result.outcome === 'SITE_CONFIRMED',
          status: result.outcome,
          message: result.message,
        });
      } catch (error) {
        sendResponse({
          ok: false,
          status: 'ERROR',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }

  private findFileInput(): HTMLInputElement | null {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]')).filter(
      (input): input is HTMLInputElement => input instanceof HTMLInputElement && !input.disabled,
    );
    const visible = inputs.find((input) => input.getClientRects().length > 0);
    return visible ?? inputs[0] ?? null;
  }

  private handleRunRequest(sendResponse: (response: AutofillRunResponse) => void): void {
    if (this.activeRun !== null) {
      sendResponse({ ok: false, error: 'RUN_IN_PROGRESS' });
      return;
    }
    const runId = createId('run');
    const controller = new AbortController();
    const pauseGate = new PauseGate();
    this.activeRun = { runId, controller, pauseGate };
    this.executeRun(runId, controller.signal, pauseGate)
      .then((summary) => {
        this.activeRun = null;
        sendResponse({ ok: true, summary });
      })
      .catch((error: unknown) => {
        this.activeRun = null;
        const message = error instanceof Error ? error.message : String(error);
        sendResponse({ ok: false, error: message });
      });
  }

  private handleCancel(): SimpleAck {
    if (this.activeRun === null) {
      return { ok: false, message: 'NO_ACTIVE_RUN' };
    }
    const { runId, controller } = this.activeRun;
    this.emit({ type: 'RUN_CANCELLED', runId });
    controller.abort('USER_CANCEL');
    return { ok: true };
  }

  private handlePause(): SimpleAck {
    if (this.activeRun === null) {
      return { ok: false, message: 'NO_ACTIVE_RUN' };
    }
    this.activeRun.pauseGate.pause();
    this.emit({ type: 'RUN_PAUSED', runId: this.activeRun.runId });
    return { ok: true };
  }

  private handleResume(): SimpleAck {
    if (this.activeRun === null) {
      return { ok: false, message: 'NO_ACTIVE_RUN' };
    }
    this.activeRun.pauseGate.resume();
    this.emit({ type: 'RUN_RESUMED', runId: this.activeRun.runId });
    return { ok: true };
  }

  private async loadCache(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get(CACHE_STORAGE_KEY);
      const serialized = stored[CACHE_STORAGE_KEY];
      if (serialized !== undefined) {
        this.fingerprintCache.loadFromJSON(serialized as ReturnType<FingerprintCache['toJSON']>);
      }
    } catch {
      return;
    }
  }

  private async saveCache(): Promise<void> {
    try {
      await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: this.fingerprintCache.toJSON() });
    } catch {
      return;
    }
  }

  private async cacheJobContext(): Promise<void> {
    try {
      const candidate = sniffJobDescription(document);
      if (candidate === undefined) {
        return;
      }
      const stored = await chrome.storage.session.get(ApplicationContextStore.STORAGE_KEY);
      const store = new ApplicationContextStore();
      store.loadFromJSON(stored[ApplicationContextStore.STORAGE_KEY]);
      store.save(candidate, location.host, location.href);
      await chrome.storage.session.set({ [ApplicationContextStore.STORAGE_KEY]: store.toJSON() });
    } catch {
      return;
    }
  }

  private async loadMemory(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get([MappingMemory.STORAGE_KEY, UserCorrectionStore.STORAGE_KEY]);
      this.mappingMemory.loadFromJSON(stored[MappingMemory.STORAGE_KEY]);
      this.userCorrections.loadFromJSON(stored[UserCorrectionStore.STORAGE_KEY]);
    } catch {
      return;
    }
  }

  private async saveMemory(): Promise<void> {
    try {
      await chrome.storage.local.set({ [MappingMemory.STORAGE_KEY]: this.mappingMemory.toJSON() });
    } catch {
      return;
    }
  }

  private async saveCorrections(): Promise<void> {
    try {
      await chrome.storage.local.set({ [UserCorrectionStore.STORAGE_KEY]: this.userCorrections.toJSON() });
    } catch {
      return;
    }
  }

  private async executeRun(runId: string, signal: AbortSignal, pauseGate: PauseGate): Promise<RunSummary> {
    const startedAt = Date.now();
    const response = await sendToBackground<{ document: CompiledResume | null }>({ type: 'GET_COMPILED_RESUME' });
    const compiled = response?.document ?? null;
    if (compiled === null) {
      const empty = this.summary(runId, startedAt, 'FAILED', [], [], 0, 0, []);
      this.emit({ type: 'RUN_FINISHED', runId, summary: empty });
      return empty;
    }
    this.lastCompiled = compiled;

    await this.loadCache();
    await this.loadMemory();
    await this.cacheJobContext();
    this.llmProposals = new Map();
    this.llmInfo = null;

    const executedKeys = new Set<string>();
    const results: FieldExecutionResult[] = [];
    const issues: MappingIssue[] = [];
    const issueKeys = new Set<string>();
    const instances = new Map<string, InstanceReport>();
    const waves: WaveExecutionSummary[] = [];
    const cycles: Array<{ sourceFieldKey: string; targetFieldKey: string }> = [];
    const steps: NonNullable<RunSummary['stepTransitions']> = [];
    let scanned = 0;
    let lastPlan: ExecutionPlan | null = null;
    let pendingFromWait = false;
    let transitionCount = 0;

    for (let index = 0; index <= MAX_STEP_TRANSITIONS; index += 1) {
      const before = this.stepObserver.capture();
      const iteration = await this.executeStepIteration(runId, signal, pauseGate, compiled, executedKeys, index === 0);
      lastPlan = iteration.plan;
      for (const result of iteration.results) {
        executedKeys.add(result.fieldKey);
      }
      results.push(...iteration.results);
      for (const issue of iteration.issues) {
        const key = JSON.stringify(issue);
        if (!issueKeys.has(key)) {
          issueKeys.add(key);
          issues.push(issue);
        }
      }
      for (const instance of iteration.instances) {
        instances.set(`${instance.sectionType}|${instance.instanceId}`, instance);
      }
      waves.push(...iteration.waves);
      cycles.push(...iteration.cycles);
      scanned += iteration.scanned;
      const after = this.stepObserver.capture();
      if (pendingFromWait || after !== before) {
        transitionCount += 1;
        steps.push({ index: transitionCount, fingerprint: after, fields: iteration.results.length });
        pendingFromWait = false;
      }
      if (signal.aborted || index >= MAX_STEP_TRANSITIONS) {
        break;
      }
      const next = await this.stepObserver.waitForChange(after, { timeoutMs: STEP_SETTLE_MS, signal });
      if (next === null) {
        break;
      }
      pendingFromWait = true;
    }

    const status = signal.aborted ? 'CANCELLED' : 'COMPLETED';
    this.lastPlan = lastPlan;
    const summary = this.summary(
      runId,
      startedAt,
      status,
      results,
      issues,
      scanned,
      results.length,
      [...instances.values()],
    );
    if (waves.length > 0) {
      summary.waves = waves;
    }
    const dependencies = this.dependencyRegistry.list();
    if (dependencies.length > 0) {
      summary.dependencies = dependencies;
    }
    if (cycles.length > 0) {
      summary.cycles = cycles;
    }
    if (lastPlan !== null && !signal.aborted) {
      const dirtyReport = await this.runDirtyCheck(runId, signal, pauseGate, lastPlan, results);
      if (dirtyReport !== undefined) {
        summary.dirty = dirtyReport;
      }
      const recovery = await this.runRecovery(runId, signal, pauseGate, lastPlan, results);
      if (recovery !== undefined) {
        summary.recovery = recovery;
      }
    }
    if (steps.length > 0) {
      summary.stepTransitions = steps;
    }
    summary.counts = { ...summary.counts, ...this.computeStatusCounts(results) };
    summary.finishedAt = Date.now();
    this.lastSummary = summary;
    this.emit({ type: 'RUN_FINISHED', runId, summary });
    this.publishPill(summary);
    return summary;
  }

  private async executeStepIteration(
    runId: string,
    signal: AbortSignal,
    pauseGate: PauseGate,
    compiled: CompiledResume,
    executedKeys: Set<string>,
    emitStart: boolean,
  ): Promise<StepIterationOutcome> {
    const preIssues: MappingIssue[] = [];
    let elements = scanFormElements(document);
    let sections = this.collectScopedSections(elements);

    let expanded = false;
    for (const section of sections) {
      const target = targetCountOf(compiled, section.sectionType);
      if (target <= 0 || section.containers.length >= target) {
        continue;
      }
      const result = await expandSection(section, target, { tracker: this.revisionTracker });
      if (result.clicks > 0) {
        expanded = true;
      }
      if (result.status === 'NO_ADD_CONTROL') {
        preIssues.push({ label: section.headingText, kind: 'REPEATER', reason: 'NO_ADD_CONTROL' });
      } else if (result.status === 'NO_PROGRESS' || result.status === 'TIMEOUT') {
        preIssues.push({ label: section.headingText, kind: 'REPEATER', reason: `EXPAND_${result.status}` });
      }
    }
    if (expanded) {
      elements = scanFormElements(document);
      sections = this.collectScopedSections(elements);
    }

    const instanceInputs: ScopedInstanceInput[] = [];
    const instanceReports: InstanceReport[] = [];
    const containerElements = new Set<HTMLElement>();
    const now = Date.now();

    for (const section of sections) {
      const sectionType = section.sectionType;
      const availableEntryIds = entryIdsOf(compiled, sectionType);
      const distilledPerContainer = section.containers.map((container) =>
        distillScopedElements(container, { sectionType, instanceId: 'instance_pending' }),
      );
      const observations = distilledPerContainer.map((items) => toObservation(sectionType, items));
      const snapshots = this.instanceRegistry.bySection(sectionType);
      const output = this.reanchorManager.reanchorSection({
        sectionType,
        observations,
        snapshots,
        availableEntryIds,
        claimedEntryIds: this.instanceRegistry.entryIdsOwnedBy(sectionType),
        allocateInstanceId: () => this.instanceRegistry.allocateInstanceId(sectionType),
      });

      output.results.forEach((result, index) => {
        const container = section.containers[index];
        const items = distilledPerContainer[index] ?? [];
        const observation = observations[index];
        if (container === undefined || observation === undefined) {
          return;
        }
        let instanceId = result.instanceId;
        if (instanceId === undefined) {
          instanceId = this.instanceRegistry.allocateInstanceId(sectionType);
        }
        for (const item of items) {
          item.field.instanceId = instanceId;
          item.field.descriptor.instanceId = instanceId;
        }
        containerElements.add(container);
        this.containerRoles.set(container, { sectionType, instanceId });

        const witness = extractWitness(sectionType, observation.fields);
        const topology = buildTopology(observation.fields);
        if (result.status === 'MATCHED' || result.status === 'NEW_INSTANCE') {
          this.instanceRegistry.upsert(instanceId, {
            sectionType,
            resumeEntryId: result.resumeEntryId,
            witness,
            topology,
            observedAt: now,
          });
        } else {
          this.instanceRegistry.reserveInstanceId(sectionType, instanceId);
        }

        instanceInputs.push({
          sectionType,
          instanceId,
          resumeEntryId: result.status === 'AMBIGUOUS' ? undefined : result.resumeEntryId,
          reanchorStatus: result.status,
          distilled: items,
          reason: result.reason,
        });
        const report: InstanceReport = {
          sectionType,
          containerIndex: index,
          instanceId,
          status: reportStatusOf(result.status),
        };
        if (result.resumeEntryId !== undefined && result.status !== 'AMBIGUOUS') {
          report.resumeEntryId = result.resumeEntryId;
        }
        if (witness.primary !== undefined) {
          report.witnessPrimary = witness.primary.value;
        }
        if (result.reason !== undefined) {
          report.reason = result.reason;
        }
        instanceReports.push(report);
      });

      for (const snapshot of output.missingSnapshots) {
        const report: InstanceReport = {
          sectionType,
          containerIndex: -1,
          instanceId: snapshot.instanceId,
          status: 'MISSING',
        };
        if (snapshot.resumeEntryId !== undefined) {
          report.resumeEntryId = snapshot.resumeEntryId;
        }
        if (snapshot.witness.primary !== undefined) {
          report.witnessPrimary = snapshot.witness.primary.value;
        }
        instanceReports.push(report);
      }
    }

    const flatElements = elements.filter((element) => !isInsideAny(element, containerElements));
    const flatDistilled = distillElements(flatElements);
    const planOptions = {
      instances: instanceInputs,
      cache: this.fingerprintCache,
      memory: this.mappingMemory,
      host: location.host,
    };
    let plan = buildExecutionPlan(compiled, flatDistilled, planOptions);
    const llmAdded = await this.collectLlmProposals(plan);
    if (llmAdded > 0) {
      plan = buildExecutionPlan(compiled, flatDistilled, {
        ...planOptions,
        llmProposals: this.llmProposals,
      });
    }
    for (const [fieldKey, element] of plan.elementByKey) {
      this.elementByKey.set(fieldKey, element);
      this.keyByElement.set(element, fieldKey);
    }

    if (emitStart) {
      this.emit({ type: 'RUN_STARTED', runId, totalFields: plan.executable.length });
    }

    const runnable: ExecutionPlan = {
      ...plan,
      executable: plan.executable.filter((field) => !executedKeys.has(field.signature.fieldKey)),
    };
    const orchestration = await this.runWaves({
      runId,
      signal,
      pauseGate,
      compiled,
      initialPlan: runnable,
      containerElements,
    });
    const results = orchestration.results;

    this.refreshSnapshots(instanceInputs);
    const verifiedKeys = new Set(
      results.filter((result) => result.status === 'VERIFIED').map((result) => result.fieldKey),
    );
    let cacheChanged = false;
    for (const candidate of plan.cacheCandidates) {
      if (verifiedKeys.has(candidate.fieldKey)) {
        this.fingerprintCache.record(candidate.input, candidate.template);
        cacheChanged = true;
      }
    }
    if (cacheChanged) {
      await this.saveCache();
    }

    let memoryChanged = false;
    for (const mapping of plan.mappings) {
      if (
        mapping.source === 'memory' &&
        mapping.targetPath !== undefined &&
        verifiedKeys.has(mapping.fieldKey)
      ) {
        this.mappingMemory.recordVerified(
          {
            host: location.host,
            sectionType: mapping.signature.sectionType,
            normalizedLabel: mapping.signature.descriptor.normalizedLabel,
            controlKind: mapping.signature.controlKind,
          },
          mapping.targetPath,
        );
        memoryChanged = true;
      }
    }
    if (memoryChanged) {
      await this.saveMemory();
    }

    const scannedCount = flatDistilled.length + instanceInputs.reduce((sum, input) => sum + input.distilled.length, 0);
    return {
      results,
      waves: orchestration.waves,
      cycles: orchestration.cycles,
      issues: [...preIssues, ...plan.issues, ...orchestration.finalPlan.issues],
      instances: instanceReports,
      scanned: scannedCount,
      plan: orchestration.finalPlan,
    };
  }

  private async runWaves(context: {
    runId: string;
    signal: AbortSignal;
    pauseGate: PauseGate;
    compiled: CompiledResume;
    initialPlan: ExecutionPlan;
    containerElements: Set<HTMLElement>;
  }): Promise<{
    results: FieldExecutionResult[];
    waves: WaveExecutionSummary[];
    cycles: Array<{ sourceFieldKey: string; targetFieldKey: string }>;
    finalPlan: ExecutionPlan;
  }> {
    const { runId, signal, pauseGate } = context;
    const scheduler = this.waveScheduler;
    const executor = (fields: ExecutableField[], _wave: ExecutionWave, waveSignal: AbortSignal) =>
      this.engine.executeRun(fields, {
        runId,
        signal: waveSignal,
        checkpoint: (checkpointSignal) => pauseGate.checkpoint(checkpointSignal),
        onEvent: (event) => this.emit(event),
      });
    const results: FieldExecutionResult[] = [];
    const waves: WaveExecutionSummary[] = [];
    const cycles: Array<{ sourceFieldKey: string; targetFieldKey: string }> = [];
    const executedKeys = new Set<string>();
    let currentPlan = context.initialPlan;
    let pending = currentPlan.executable.slice();
    let passes = 0;
    while (pending.length > 0 && passes <= MAX_RECONCILE_PASSES) {
      const groups = scheduler.groupByWave(pending);
      let sawAdded = false;
      for (const wave of scheduler.order) {
        const fields = groups.get(wave) ?? [];
        if (fields.length === 0) {
          continue;
        }
        const outcome = await scheduler.runWave(wave, fields, { executor, signal });
        waves.push(outcome.summary);
        cycles.push(...outcome.cycles);
        for (const result of outcome.results) {
          executedKeys.add(result.fieldKey);
        }
        results.push(...outcome.results);
        if (outcome.delta.added.length > 0) {
          sawAdded = true;
        }
      }
      if (!sawAdded || signal.aborted) {
        break;
      }
      passes += 1;
      if (passes > MAX_RECONCILE_PASSES) {
        break;
      }
      currentPlan = this.rebuildPlan(context.compiled, context.containerElements);
      pending = currentPlan.executable.filter((field) => !executedKeys.has(field.signature.fieldKey));
    }
    return { results, waves, cycles, finalPlan: currentPlan };
  }

  private async runDirtyCheck(
    runId: string,
    signal: AbortSignal,
    pauseGate: PauseGate,
    plan: ExecutionPlan,
    results: FieldExecutionResult[],
  ): Promise<RunSummary['dirty']> {
    if (signal.aborted) {
      return undefined;
    }
    const verified = new Map<string, FieldExecutionResult>();
    for (const result of results) {
      if (result.status === 'VERIFIED') {
        verified.set(result.fieldKey, result);
      } else {
        verified.delete(result.fieldKey);
      }
    }
    if (verified.size === 0) {
      const sweep = this.sweepPageResults(verified, results);
      return {
        checked: 0,
        refilled: 0,
        dirty: [],
        lost: [],
        userProtected: [],
        ...(sweep.validationErrors.length > 0 ? { validationErrors: sweep.validationErrors } : {}),
        ...(sweep.newRequired.length > 0 ? { newRequired: sweep.newRequired } : {}),
      };
    }
    const executableByKey = new Map<string, ExecutableField>();
    for (const executable of plan.executable) {
      executableByKey.set(executable.signature.fieldKey, executable);
    }
    const candidates: DirtyCandidate[] = [];
    for (const [fieldKey, result] of verified) {
      if (!isDirtyCheckable(result.controlKind)) {
        continue;
      }
      const executable = executableByKey.get(fieldKey);
      const element = this.resolveElement(fieldKey) ?? executable?.element ?? null;
      if (element === null) {
        continue;
      }
      const expectedText = executable?.expectedText ?? String(executable?.expectedValue ?? result.expectedValue ?? '');
      if (expectedText === '') {
        continue;
      }
      const candidate: DirtyCandidate = {
        fieldKey,
        expectedText,
        controlKind: result.controlKind,
        element,
      };
      if (executable !== undefined) {
        candidate.refill = { ...executable, element };
      }
      candidates.push(candidate);
    }
    const outcome = await this.dirtyChecker.check(candidates, {
      isUserProtected: (fieldKey) => this.registry.isUserProtected(fieldKey),
      refill: (fields) =>
        this.engine.executeRun(fields, {
          runId,
          signal,
          checkpoint: (checkpointSignal) => pauseGate.checkpoint(checkpointSignal),
          onEvent: (event) => this.emit(event),
        }),
    });
    for (const result of outcome.refillResults) {
      const index = results.findIndex((existing) => existing.fieldKey === result.fieldKey);
      if (index >= 0) {
        results[index] = result;
      } else {
        results.push(result);
      }
    }
    const sweep = this.sweepPageResults(verified, results);
    for (const [fieldKey, errorInfo] of sweep.errorByField) {
      if (this.registry.isUserProtected(fieldKey)) {
        continue;
      }
      const entry = results.find((candidate) => candidate.fieldKey === fieldKey);
      if (entry !== undefined) {
        entry.status = 'NEEDS_MANUAL';
        entry.reason = `VALIDATION_ERROR: ${errorInfo.message}`;
      }
    }
    if (sweep.validationErrors.length > 0) {
      outcome.report.validationErrors = sweep.validationErrors;
    }
    if (sweep.newRequired.length > 0) {
      outcome.report.newRequired = sweep.newRequired;
    }
    return outcome.report;
  }

  private sweepPageResults(
    verified: Map<string, FieldExecutionResult>,
    results: FieldExecutionResult[],
  ): { validationErrors: string[]; errorByField: Map<string, { message: string }>; newRequired: string[] } {
    const validationErrors: string[] = [];
    const errorByField = new Map<string, { message: string }>();
    for (const [fieldKey, result] of verified) {
      const element = this.resolveElement(fieldKey);
      if (element === null) {
        continue;
      }
      const info = detectValidationError(element);
      if (info.hasError) {
        const label = result.label !== '' ? result.label : fieldKey;
        validationErrors.push(`${label}: ${info.message}`);
        errorByField.set(fieldKey, { message: info.message });
      }
    }
    const handledKeys = new Set(results.map((result) => result.fieldKey));
    const newRequired: string[] = [];
    const elements = scanFormElements(document);
    for (const element of elements) {
      if (!(element instanceof HTMLElement) || !isFormElement(element)) {
        continue;
      }
      const required =
        (element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).required === true ||
        element.getAttribute('aria-required') === 'true';
      if (!required) {
        continue;
      }
      const fieldKey = this.resolveFieldKey(element);
      if (fieldKey === undefined || handledKeys.has(fieldKey)) {
        continue;
      }
      const role = this.findContainerRole(element);
      const distilled =
        role === undefined
          ? distillField(element)
          : distillField(element, { sectionType: role.sectionType, instanceId: role.instanceId });
      const label = distilled !== undefined && distilled.label !== '' ? distilled.label : '';
      newRequired.push(label !== '' ? label : fieldKey);
    }
    return { validationErrors, errorByField, newRequired };
  }

  private async runRecovery(
    runId: string,
    signal: AbortSignal,
    pauseGate: PauseGate,
    plan: ExecutionPlan,
    results: FieldExecutionResult[],
  ): Promise<NonNullable<RunSummary['recovery']> | undefined> {
    if (signal.aborted) {
      return undefined;
    }
    const executableByKey = new Map<string, ExecutableField>();
    for (const executable of plan.executable) {
      executableByKey.set(executable.signature.fieldKey, executable);
    }
    const candidates: RecoveryCandidate[] = [];
    for (const result of results) {
      if (result.status !== 'RETRYABLE' && result.status !== 'NEEDS_MANUAL' && result.status !== 'CIRCUIT_BROKEN') {
        continue;
      }
      const executable = executableByKey.get(result.fieldKey);
      const element = this.resolveElement(result.fieldKey) ?? executable?.element ?? null;
      const connected = element !== null && element.isConnected;
      const expectedText =
        executable?.expectedText ??
        (executable?.expectedValue !== undefined && executable?.expectedValue !== null
          ? String(executable.expectedValue)
          : '');
      candidates.push({
        fieldKey: result.fieldKey,
        label: result.label,
        status: result.status,
        elementConnected: connected,
        valueMatchesExpected: connected && expectedText !== '' ? observedValueMatches(element, result.controlKind, expectedText) : false,
        validationError: connected && detectValidationError(element).hasError,
        expectedText,
        refillable: executable !== undefined,
        ...(result.reason !== undefined ? { reason: result.reason } : {}),
      });
    }
    if (candidates.length === 0) {
      return undefined;
    }
    const decisions = this.recoveryPlanner.plan(candidates);
    if (decisions.length === 0) {
      return undefined;
    }
    const stats = { reverified: 0, refilled: 0, manual: 0 };
    const refillFields: ExecutableField[] = [];
    for (const decision of decisions) {
      const result = results.find((candidate) => candidate.fieldKey === decision.fieldKey);
      if (result === undefined) {
        continue;
      }
      if (decision.action === 'REVERIFY') {
        result.status = 'VERIFIED';
        delete result.reason;
        stats.reverified += 1;
        continue;
      }
      if (decision.action === 'REFILL') {
        const executable = executableByKey.get(decision.fieldKey);
        if (executable !== undefined) {
          refillFields.push(executable);
        }
        continue;
      }
      stats.manual += 1;
      if (result.status === 'RETRYABLE') {
        result.status = 'NEEDS_MANUAL';
      }
      const existing = result.reason ?? '';
      if (existing === '') {
        result.reason = `recovery:${decision.reason}`;
      } else if (!existing.includes(decision.reason)) {
        result.reason = `${existing} | recovery:${decision.reason}`;
      }
    }
    if (refillFields.length > 0) {
      const refillResults = await this.engine.executeRun(refillFields, {
        runId,
        signal,
        checkpoint: (checkpointSignal) => pauseGate.checkpoint(checkpointSignal),
        onEvent: (event) => this.emit(event),
      });
      for (const refillResult of refillResults) {
        const index = results.findIndex((existing) => existing.fieldKey === refillResult.fieldKey);
        if (index >= 0) {
          results[index] = refillResult;
        } else {
          results.push(refillResult);
        }
        const element = this.resolveElement(refillResult.fieldKey);
        if (refillResult.status === 'VERIFIED' && element !== null) {
          const info = detectValidationError(element);
          if (info.hasError) {
            refillResult.status = 'NEEDS_MANUAL';
            refillResult.reason = `VALIDATION_ERROR: ${info.message}`;
          }
        }
        stats.refilled += 1;
      }
    }
    return stats;
  }

  private computeStatusCounts(results: FieldExecutionResult[]): {
    executed: number;
    verified: number;
    userOverridden: number;
    needsManual: number;
    cancelled: number;
  } {
    return {
      executed: results.filter((result) => result.attempts > 0).length,
      verified: results.filter((result) => result.status === 'VERIFIED').length,
      userOverridden: results.filter((result) => result.status === 'USER_OVERRIDDEN').length,
      needsManual: results.filter(
        (result) =>
          result.status === 'NEEDS_MANUAL' || result.status === 'RETRYABLE' || result.status === 'CIRCUIT_BROKEN',
      ).length,
      cancelled: results.filter((result) => result.status === 'CANCELLED').length,
    };
  }

  private publishPill(summary: RunSummary): void {
    const failures = summary.fields.filter(
      (result) =>
        result.reason !== 'USER_SKIPPED' &&
        (result.status === 'NEEDS_MANUAL' || result.status === 'RETRYABLE' || result.status === 'CIRCUIT_BROKEN'),
    );
    const fields: PillFieldView[] = failures.map((result) => ({
      fieldKey: result.fieldKey,
      label: result.label,
      status: result.status,
      reason: result.reason ?? '',
      targetPreview: this.executableFor(result.fieldKey)?.expectedText ?? '',
    }));
    const failureKeys = new Set(fields.map((field) => field.fieldKey));
    const essayCapable = this.essayCapable();
    const issueRows: PillFieldView[] = summary.mappingIssues
      .filter(
        (issue) =>
          issue.fieldKey !== undefined &&
          !failureKeys.has(issue.fieldKey) &&
          (issue.kind === 'UNMAPPED' || issue.kind === 'NO_DATA' || issue.kind === 'NO_OPTION'),
      )
      .map((issue) => ({
        fieldKey: issue.fieldKey as string,
        label: issue.label,
        status: 'NEEDS_MANUAL' as const,
        reason: issue.reason,
        targetPreview: '',
        requiresSource: true,
        ...(essayCapable && this.controlKindFor(issue.fieldKey as string) === 'textarea' ? { essay: true } : {}),
      }));
    fields.push(...issueRows);
    if (fields.length === 0) {
      this.pill?.destroy();
      this.pill = null;
      return;
    }
    if (this.pill === null) {
      this.pill = mountQuickFillPill(this.buildPillActions());
    }
    this.pill.setFields(fields);
  }

  private buildPillActions(): QuickFillPillActions {
    return {
      onRetry: (fieldKey) => {
        void this.pillRetryField(fieldKey);
      },
      onCopy: (fieldKey) => {
        this.copyTargetValue(fieldKey);
      },
      onListAlternatives: async (): Promise<ResumePathOption[]> => {
        if (this.lastCompiled === null) {
          return [];
        }
        return listResumeValuePaths(this.lastCompiled);
      },
      onRemap: (fieldKey, path) => {
        void this.pillRemapField(fieldKey, path);
      },
      onSkip: (fieldKey) => {
        this.mutatePillResult(fieldKey, (result) => {
          result.status = 'NEEDS_MANUAL';
          result.reason = 'USER_SKIPPED';
        });
      },
      onMarkChecked: (fieldKey) => {
        this.registry.noteUserEdit(fieldKey);
        this.recordManualEdit(fieldKey);
        this.mutatePillResult(fieldKey, (result) => {
          result.status = 'USER_OVERRIDDEN';
          result.reason = 'USER_CONFIRMED_MANUAL';
        });
      },
      onFocusField: (fieldKey) => {
        this.focusField(fieldKey);
      },
      onGenerateEssay: (fieldKey) => this.generateEssay(fieldKey),
      onApplyEssay: (fieldKey, text) => {
        void this.applyEssay(fieldKey, text);
      },
    };
  }

  private async loadJobContext(): Promise<ApplicationContext | undefined> {
    try {
      const stored = await chrome.storage.session.get(ApplicationContextStore.STORAGE_KEY);
      const store = new ApplicationContextStore();
      store.loadFromJSON(stored[ApplicationContextStore.STORAGE_KEY]);
      return store.get(location.host);
    } catch {
      return undefined;
    }
  }

  private essayCapable(): boolean {
    const compiled = this.lastCompiled;
    if (compiled === null) {
      return false;
    }
    return compiled.normalized.projects.length > 0 || compiled.projections.introShort !== undefined;
  }

  private async generateEssay(fieldKey: string): Promise<EssayDraft | undefined> {
    const compiled = this.lastCompiled;
    if (compiled === null) {
      return undefined;
    }
    let projection: EssayProjection | undefined;
    const firstProject = compiled.normalized.projects[0];
    if (firstProject !== undefined) {
      const detail = [firstProject.role, firstProject.description]
        .filter((part): part is string => part !== undefined && part !== '')
        .join(' ');
      projection = { label: `项目经历「${firstProject.name}」`, text: detail !== '' ? detail : firstProject.name };
    } else if (compiled.projections.introShort !== undefined) {
      projection = { label: '简介摘要', text: compiled.projections.introShort };
    }
    if (projection === undefined) {
      return undefined;
    }
    const jd = await this.loadJobContext();
    const label =
      this.lastPlan?.mappings.find((mapping) => mapping.fieldKey === fieldKey)?.signature.label ?? '';
    const draft = generateEssayDraft({
      ...(label !== '' ? { question: label } : {}),
      ...(jd !== undefined ? { jd } : {}),
      projection,
    });
    const jdSuffix = jd?.title !== undefined && jd.title !== '' ? ` · JD：${jd.title}` : '';
    return { draft, source: `${projection.label}${jdSuffix}` };
  }

  private async applyEssay(fieldKey: string, text: string): Promise<void> {
    const summary = this.lastSummary;
    if (summary === null || this.activeRun !== null || text.trim() === '') {
      return;
    }
    const element = this.resolveElement(fieldKey);
    if (element === null) {
      return;
    }
    const role = this.findContainerRole(element);
    const distilled =
      role === undefined
        ? distillField(element)
        : distillField(element, { sectionType: role.sectionType, instanceId: role.instanceId });
    if (distilled === undefined) {
      return;
    }
    const executable: ExecutableField = {
      signature: { ...distilled, fieldKey },
      element,
      expectedValue: text,
      expectedText: text,
      targetPath: 'essay.draft',
    };
    const controller = new AbortController();
    const pauseGate = new PauseGate();
    const results = await this.engine.executeRun([executable], {
      runId: summary.runId,
      signal: controller.signal,
      checkpoint: (checkpointSignal) => pauseGate.checkpoint(checkpointSignal),
      onEvent: (event) => this.emit(event),
    });
    const applied = results[0];
    if (applied === undefined) {
      return;
    }
    this.finalizeRetriedResult(applied);
    this.mergeResultIntoSummary(summary, applied);
    if (applied.status === 'VERIFIED') {
      summary.mappingIssues = summary.mappingIssues.filter((issue) => issue.fieldKey !== fieldKey);
    }
    this.refreshSummary(summary);
  }

  private recordManualEdit(fieldKey: string): void {
    const result = this.lastSummary?.fields.find((candidate) => candidate.fieldKey === fieldKey);
    if (result === undefined) {
      return;
    }
    this.userCorrections.append({
      host: location.host,
      label: result.label,
      controlKind: result.controlKind,
      kind: 'MANUAL_EDIT',
    });
    void this.saveCorrections();
  }

  private mutatePillResult(fieldKey: string, mutate: (result: FieldExecutionResult) => void): void {
    const summary = this.lastSummary;
    if (summary === null) {
      return;
    }
    const result = summary.fields.find((candidate) => candidate.fieldKey === fieldKey);
    if (result === undefined) {
      return;
    }
    mutate(result);
    if (this.activeRun !== null) {
      this.engine.revokeField(fieldKey);
    }
    this.refreshSummary(summary);
  }

  private refreshSummary(summary: RunSummary): void {
    summary.counts = { ...summary.counts, ...this.computeStatusCounts(summary.fields) };
    summary.finishedAt = Date.now();
    this.emit({ type: 'RUN_FINISHED', runId: summary.runId, summary });
    this.publishPill(summary);
  }

  private executableFor(fieldKey: string): ExecutableField | undefined {
    return this.lastPlan?.executable.find((executable) => executable.signature.fieldKey === fieldKey);
  }

  private controlKindFor(fieldKey: string): ControlKind | undefined {
    return this.lastPlan?.mappings.find((mapping) => mapping.fieldKey === fieldKey)?.signature.controlKind;
  }

  private async pillRetryField(fieldKey: string): Promise<void> {
    const summary = this.lastSummary;
    const executable = this.executableFor(fieldKey);
    if (summary === null || executable === null || executable === undefined || this.activeRun !== null) {
      return;
    }
    const controller = new AbortController();
    const pauseGate = new PauseGate();
    const results = await this.engine.executeRun([executable], {
      runId: summary.runId,
      signal: controller.signal,
      checkpoint: (checkpointSignal) => pauseGate.checkpoint(checkpointSignal),
      onEvent: (event) => this.emit(event),
    });
    const retried = results[0];
    if (retried === undefined) {
      return;
    }
    this.finalizeRetriedResult(retried);
    this.mergeResultIntoSummary(summary, retried);
    this.refreshSummary(summary);
  }

  private async pillRemapField(fieldKey: string, path: string): Promise<void> {
    const summary = this.lastSummary;
    const compiled = this.lastCompiled;
    if (summary === null || compiled === null || this.activeRun !== null) {
      return;
    }
    const element = this.resolveElement(fieldKey);
    if (element === null) {
      return;
    }
    const role = this.findContainerRole(element);
    const distilled =
      role === undefined
        ? distillField(element)
        : distillField(element, { sectionType: role.sectionType, instanceId: role.instanceId });
    if (distilled === undefined) {
      return;
    }
    const resolved = resolveResumePath({ normalized: compiled.normalized, projections: compiled.projections }, path);
    if (!resolved.found) {
      return;
    }
    const formatted = formatForField(resolved.value, distilled);
    if (!formatted.ok) {
      return;
    }
    const executable: ExecutableField = {
      signature: { ...distilled, fieldKey },
      element,
      expectedValue: formatted.value,
      expectedText: formatted.expectedText,
      targetPath: path,
    };
    if (this.lastPlan !== null) {
      const index = this.lastPlan.executable.findIndex((candidate) => candidate.signature.fieldKey === fieldKey);
      if (index >= 0) {
        this.lastPlan.executable[index] = executable;
      } else {
        this.lastPlan.executable.push(executable);
      }
    }
    const controller = new AbortController();
    const pauseGate = new PauseGate();
    const results = await this.engine.executeRun([executable], {
      runId: summary.runId,
      signal: controller.signal,
      checkpoint: (checkpointSignal) => pauseGate.checkpoint(checkpointSignal),
      onEvent: (event) => this.emit(event),
    });
    const retried = results[0];
    if (retried === undefined) {
      return;
    }
    this.finalizeRetriedResult(retried);
    this.mergeResultIntoSummary(summary, retried);
    if (retried.status === 'VERIFIED') {
      this.mappingMemory.recordUserChoice(
        {
          host: location.host,
          sectionType: distilled.sectionType,
          normalizedLabel: distilled.descriptor.normalizedLabel,
          controlKind: distilled.controlKind,
        },
        path,
      );
      this.userCorrections.append({
        host: location.host,
        label: distilled.descriptor.normalizedLabel,
        controlKind: distilled.controlKind,
        kind: 'REMAP',
        targetPath: path,
      });
      summary.mappingIssues = summary.mappingIssues.filter(
        (issue) =>
          !(
            issue.fieldKey === fieldKey &&
            (issue.kind === 'UNMAPPED' || issue.kind === 'NO_DATA' || issue.kind === 'NO_OPTION')
          ),
      );
      await this.saveMemory();
      await this.saveCorrections();
    }
    this.refreshSummary(summary);
  }

  private finalizeRetriedResult(result: FieldExecutionResult): void {
    if (result.status !== 'VERIFIED') {
      return;
    }
    const element = this.resolveElement(result.fieldKey);
    if (element === null) {
      return;
    }
    const info = detectValidationError(element);
    if (info.hasError) {
      result.status = 'NEEDS_MANUAL';
      result.reason = `VALIDATION_ERROR: ${info.message}`;
    }
  }

  private mergeResultIntoSummary(summary: RunSummary, result: FieldExecutionResult): void {
    const index = summary.fields.findIndex((candidate) => candidate.fieldKey === result.fieldKey);
    if (index >= 0) {
      summary.fields[index] = result;
    } else {
      summary.fields.push(result);
    }
  }

  private focusField(fieldKey: string): void {
    const element = this.resolveElement(fieldKey);
    if (element === null) {
      return;
    }
    element.scrollIntoView({ block: 'center' });
    const previousOutline = element.style.outline;
    const previousOffset = element.style.outlineOffset;
    element.style.outline = '2px solid #2563eb';
    element.style.outlineOffset = '2px';
    window.setTimeout(() => {
      element.style.outline = previousOutline;
      element.style.outlineOffset = previousOffset;
    }, 1200);
  }

  private copyTargetValue(fieldKey: string): void {
    const text = this.executableFor(fieldKey)?.expectedText ?? '';
    if (text === '') {
      return;
    }
    const clipboard = navigator.clipboard as { writeText?: (value: string) => Promise<void> } | undefined;
    if (clipboard?.writeText !== undefined) {
      void clipboard.writeText(text).catch(() => {
        this.fallbackCopy(text);
      });
      return;
    }
    this.fallbackCopy(text);
  }

  private fallbackCopy(text: string): void {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('data-applyfill-ui', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
    } catch {
      void 0;
    }
    area.remove();
  }

  private async collectLlmProposals(plan: ExecutionPlan): Promise<number> {
    const refs: UnmappedFieldRef[] = [];
    for (const issue of plan.issues) {
      if (issue.kind !== 'UNMAPPED' || issue.fieldKey === undefined || this.llmProposals.has(issue.fieldKey)) {
        continue;
      }
      const mapping = plan.mappings.find((entry) => entry.fieldKey === issue.fieldKey);
      if (mapping === undefined) {
        continue;
      }
      refs.push({
        fieldKey: issue.fieldKey,
        label: issue.label,
        controlKind: mapping.signature.controlKind,
        sectionType: mapping.signature.sectionType,
      });
    }
    if (refs.length === 0) {
      return 0;
    }
    this.llmInfo = this.llmInfo ?? { requested: 0, proposed: 0, failed: false };
    this.llmInfo.requested += refs.length;
    let routed: Map<string, RoutedProposal>;
    try {
      routed = await this.llmRouter.route(refs);
    } catch {
      this.llmInfo.failed = true;
      return 0;
    }
    for (const [fieldKey, proposal] of routed) {
      this.llmProposals.set(fieldKey, proposal);
    }
    this.llmInfo.proposed += routed.size;
    return routed.size;
  }

  private rebuildPlan(compiled: CompiledResume, containerElements: Set<HTMLElement>): ExecutionPlan {
    const elements = scanFormElements(document);
    const flat = elements.filter((element) => !isInsideAny(element, containerElements));
    const rebuilt = buildExecutionPlan(compiled, distillElements(flat), {
      cache: this.fingerprintCache,
      memory: this.mappingMemory,
      host: location.host,
      ...(this.llmProposals.size > 0 ? { llmProposals: this.llmProposals } : {}),
    });
    for (const [fieldKey, element] of rebuilt.elementByKey) {
      this.elementByKey.set(fieldKey, element);
      this.keyByElement.set(element, fieldKey);
    }
    return rebuilt;
  }

  private collectScopedSections(elements: HTMLElement[]): ScannedSection[] {
    return scanRepeatableSections(document, elements).filter((section) =>
      SCOPED_SECTION_TYPES.has(section.sectionType),
    );
  }

  private refreshSnapshots(instanceInputs: ScopedInstanceInput[]): void {
    const now = Date.now();
    for (const input of instanceInputs) {
      if (input.reanchorStatus === 'AMBIGUOUS') {
        continue;
      }
      const observation = toObservation(input.sectionType, input.distilled);
      this.instanceRegistry.upsert(input.instanceId, {
        sectionType: input.sectionType,
        resumeEntryId: input.resumeEntryId,
        witness: extractWitness(input.sectionType, observation.fields),
        topology: buildTopology(observation.fields),
        observedAt: now,
      });
    }
  }

  private summary(
    runId: string,
    startedAt: number,
    status: RunSummary['status'],
    results: FieldExecutionResult[],
    issues: RunSummary['mappingIssues'],
    scanned: number,
    mapped: number,
    instances: InstanceReport[],
  ): RunSummary {
    const summary: RunSummary = {
      runId,
      startedAt,
      finishedAt: Date.now(),
      status,
      counts: { scanned, mapped, ...this.computeStatusCounts(results) },
      fields: results,
      mappingIssues: issues,
    };
    if (instances.length > 0) {
      summary.instances = instances;
    }
    if (this.llmInfo !== null) {
      summary.llm = { ...this.llmInfo };
    }
    return summary;
  }

  private resolveElement(fieldKey: string): HTMLElement | null {
    const cached = this.elementByKey.get(fieldKey);
    if (cached !== undefined && cached.isConnected) {
      return cached;
    }
    const rescanned = distillElements(scanFormElements(document));
    for (const item of rescanned) {
      const identity = buildFieldIdentity(item.field.descriptor);
      if (identity.fieldKey === fieldKey) {
        this.elementByKey.set(fieldKey, item.element);
        this.keyByElement.set(item.element, fieldKey);
        return item.element;
      }
    }
    return null;
  }

  private resolveFieldKey(target: Element): string | undefined {
    const direct = this.keyByElement.get(target);
    if (direct !== undefined) {
      return direct;
    }
    const candidate = isFormElement(target) ? target : target.closest(FORM_CONTROL_SELECTOR);
    if (!(candidate instanceof HTMLElement)) {
      return undefined;
    }
    const cached = this.keyByElement.get(candidate);
    if (cached !== undefined) {
      return cached;
    }
    const role = this.findContainerRole(candidate);
    const distilled =
      role === undefined
        ? distillField(candidate)
        : distillField(candidate, { sectionType: role.sectionType, instanceId: role.instanceId });
    if (distilled === undefined) {
      return undefined;
    }
    const fieldKey = buildFieldIdentity(distilled.descriptor).fieldKey;
    this.elementByKey.set(fieldKey, candidate);
    this.keyByElement.set(candidate, fieldKey);
    return fieldKey;
  }

  private findContainerRole(element: Element): ContainerRole | undefined {
    let node: Element | null = element.parentElement;
    while (node !== null) {
      const role = this.containerRoles.get(node);
      if (role !== undefined) {
        return role;
      }
      node = node.parentElement;
    }
    return undefined;
  }

  private handleUserEdit(fieldKey: string, event: Event, target: Element): void {
    const activationEvent = event.type === 'input' || event.type === 'change';
    if (activationEvent) {
      const lastInteraction = this.lastUserInteractions.get(target);
      const since =
        lastInteraction === undefined ? Number.POSITIVE_INFINITY : Date.now() - lastInteraction;
      if (this.engine.isWriting(fieldKey) && since > USER_EDIT_PRECURSOR_WINDOW_MS) {
        return;
      }
    } else {
      this.lastUserInteractions.set(target, Date.now());
    }
    this.registry.noteUserEdit(fieldKey);
    this.engine.revokeField(fieldKey);
  }

  private emit(event: RunEvent): void {
    sendToBackground({ type: 'RUN_EVENT', event }).catch(() => undefined);
  }
}

function isInsideAny(element: Element, containers: Set<HTMLElement>): boolean {
  for (const container of containers) {
    if (container.contains(element)) {
      return true;
    }
  }
  return false;
}
