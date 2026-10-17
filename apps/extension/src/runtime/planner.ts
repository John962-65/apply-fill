import type { ExecutableField } from '@/actuator/FieldExecutionEngine';
import { formatForField } from '@/formatter';
import { buildFieldIdentity } from '@/identity';
import type { MappingMemory } from '@/memory/MappingMemory';
import type { DistilledElement } from '@/perceptor';
import type { FingerprintCache, FingerprintInput, ResumeRouteSource } from '@/router';
import { matchRule, normalizeForMatch, resolveResumePath, substituteIndex } from '@/router';
import type { CompiledResume } from '@/shared/contracts/resume';
import type { FieldMapping, FieldSignature, MappingIssue, SectionType } from '@/shared/contracts/field';
import type { ReanchorStatus } from '@/shared/contracts/reanchor';

export interface ScopedInstanceInput {
  sectionType: SectionType;
  instanceId: string;
  resumeEntryId?: string;
  reanchorStatus: ReanchorStatus;
  distilled: DistilledElement[];
  reason?: string;
}

export interface CacheCandidate {
  fieldKey: string;
  input: FingerprintInput;
  template: string;
}

export interface ExecutionPlan {
  executable: ExecutableField[];
  mappings: FieldMapping[];
  issues: MappingIssue[];
  elementByKey: Map<string, HTMLElement>;
  cacheCandidates: CacheCandidate[];
}

export interface PlanOptions {
  instances?: ScopedInstanceInput[];
  cache?: FingerprintCache;
  memory?: MappingMemory;
  host?: string;
  llmProposals?: Map<string, { targetPathTemplate: string; confidence: number }>;
}

interface MappingContext {
  routeSource: ResumeRouteSource;
  cache: FingerprintCache | undefined;
  memory: MappingMemory | undefined;
  host: string;
  llmProposals: Map<string, { targetPathTemplate: string; confidence: number }> | undefined;
  executable: ExecutableField[];
  mappings: FieldMapping[];
  issues: MappingIssue[];
  elementByKey: Map<string, HTMLElement>;
  cacheCandidates: CacheCandidate[];
}

function buildSignature(distilled: DistilledElement): FieldSignature {
  return {
    ...distilled.field,
    fieldKey: buildFieldIdentity(distilled.field.descriptor).fieldKey,
  };
}

function mapField(ctx: MappingContext, item: DistilledElement, indexForPath: number): void {
  const signature = buildSignature(item);
  ctx.elementByKey.set(signature.fieldKey, item.element);

  if (signature.disabled) {
    ctx.issues.push({ label: signature.label, kind: 'DISABLED', reason: 'FIELD_DISABLED' });
    ctx.mappings.push({
      fieldKey: signature.fieldKey,
      signature,
      status: 'DISABLED',
      source: 'rule',
      confidence: 0,
      reason: 'FIELD_DISABLED',
    });
    return;
  }
  if (signature.readonly) {
    ctx.issues.push({ label: signature.label, kind: 'READONLY', reason: 'FIELD_READONLY' });
    ctx.mappings.push({
      fieldKey: signature.fieldKey,
      signature,
      status: 'READONLY',
      source: 'rule',
      confidence: 0,
      reason: 'FIELD_READONLY',
    });
    return;
  }

  const fingerprintInput: FingerprintInput = {
    host: ctx.host,
    sectionType: signature.sectionType,
    normalizedLabel: signature.descriptor.normalizedLabel,
    controlKind: signature.controlKind,
  };
  const cacheHit = ctx.cache?.get(fingerprintInput);

  let template: string | undefined;
  let source: FieldMapping['source'] = 'rule';
  let confidence = 0;

  if (cacheHit !== undefined) {
    template = cacheHit.targetPathTemplate;
    source = 'cache';
    confidence = 0.9;
  } else {
    const memoryHit = ctx.memory?.lookup(fingerprintInput);
    if (memoryHit !== undefined) {
      const memoryPath = substituteIndex(memoryHit.targetPath, indexForPath);
      if (resolveResumePath(ctx.routeSource, memoryPath).found) {
        template = memoryHit.targetPath;
        source = 'memory';
        confidence = memoryHit.source === 'user' ? 0.92 : 0.88;
      }
    }
  }

  if (template === undefined) {
    const matched = matchRule(signature.controlKind, normalizeForMatch(signature.descriptor.normalizedLabel));
    if (matched !== undefined) {
      template = matched.targetPath;
      source = 'rule';
      confidence = 0.95;
    } else {
      const llmProposal = ctx.llmProposals?.get(signature.fieldKey);
      if (llmProposal !== undefined) {
        template = llmProposal.targetPathTemplate;
        source = 'llm';
        confidence = llmProposal.confidence;
      }
    }
  }

  if (template === undefined) {
    ctx.issues.push({ label: signature.label, kind: 'UNMAPPED', reason: 'NO_RULE_MATCH', fieldKey: signature.fieldKey });
    ctx.mappings.push({
      fieldKey: signature.fieldKey,
      signature,
      status: 'UNMAPPED',
      source: 'rule',
      confidence: 0,
      reason: 'NO_RULE_MATCH',
    });
    return;
  }

  const targetPath = substituteIndex(template, indexForPath);
  const resolved = resolveResumePath(ctx.routeSource, targetPath);
  if (!resolved.found) {
    ctx.issues.push({ label: signature.label, kind: 'NO_DATA', reason: 'RESUME_VALUE_MISSING', fieldKey: signature.fieldKey });
    ctx.mappings.push({
      fieldKey: signature.fieldKey,
      signature,
      targetPath,
      status: 'NO_DATA',
      source,
      confidence,
      reason: 'RESUME_VALUE_MISSING',
    });
    return;
  }

  const formatted = formatForField(resolved.value, signature);
  if (!formatted.ok) {
    const kind = formatted.reason === 'NO_OPTION_MATCH' ? 'NO_OPTION' : 'NO_DATA';
    ctx.issues.push({ label: signature.label, kind, reason: formatted.reason, fieldKey: signature.fieldKey });
    ctx.mappings.push({
      fieldKey: signature.fieldKey,
      signature,
      targetPath,
      rawValue: resolved.value as FieldMapping['rawValue'],
      status: kind === 'NO_OPTION' ? 'NO_OPTION' : 'NO_DATA',
      source,
      confidence,
      reason: formatted.reason,
    });
    return;
  }

  ctx.mappings.push({
    fieldKey: signature.fieldKey,
    signature,
    targetPath,
    expectedValue: formatted.value,
    expectedText: formatted.expectedText,
    status: 'MAPPED',
    source,
    confidence,
  });
  ctx.executable.push({
    signature,
    element: item.element,
    expectedValue: formatted.value,
    expectedText: formatted.expectedText,
    targetPath,
  });
  if (source !== 'cache' && source !== 'memory') {
    ctx.cacheCandidates.push({ fieldKey: signature.fieldKey, input: fingerprintInput, template });
  }
}

function markInstanceNotExecutable(
  ctx: MappingContext,
  item: DistilledElement,
  status: FieldMapping['status'],
  kind: MappingIssue['kind'],
  reason: string,
): void {
  const signature = buildSignature(item);
  ctx.elementByKey.set(signature.fieldKey, item.element);
  ctx.mappings.push({
    fieldKey: signature.fieldKey,
    signature,
    status,
    source: 'rule',
    confidence: 0,
    reason,
  });
  ctx.issues.push({ label: signature.label, kind, reason, fieldKey: signature.fieldKey });
}

export function buildExecutionPlan(
  compiled: CompiledResume,
  distilled: DistilledElement[],
  options: PlanOptions = {},
): ExecutionPlan {
  const ctx: MappingContext = {
    routeSource: { normalized: compiled.normalized, projections: compiled.projections },
    cache: options.cache,
    memory: options.memory,
    host: options.host ?? '',
    llmProposals: options.llmProposals,
    executable: [],
    mappings: [],
    issues: [],
    elementByKey: new Map<string, HTMLElement>(),
    cacheCandidates: [],
  };

  for (const item of distilled) {
    mapField(ctx, item, 0);
  }

  for (const instance of options.instances ?? []) {
    if (instance.reanchorStatus === 'AMBIGUOUS') {
      for (const item of instance.distilled) {
        markInstanceNotExecutable(ctx, item, 'AMBIGUOUS', 'AMBIGUOUS', instance.reason ?? 'REANCHOR_AMBIGUOUS');
      }
      continue;
    }
    const entries = entriesOf(compiled, instance.sectionType);
    let indexForPath: number | undefined;
    if (instance.resumeEntryId !== undefined) {
      const index = entries.findIndex((entry) => entry.id === instance.resumeEntryId);
      if (index >= 0) {
        indexForPath = index;
      }
    }
    if (indexForPath === undefined) {
      for (const item of instance.distilled) {
        markInstanceNotExecutable(ctx, item, 'NO_DATA', 'NO_DATA', 'NO_RESUME_ENTRY');
      }
      continue;
    }
    for (const item of instance.distilled) {
      mapField(ctx, item, indexForPath);
    }
  }

  return {
    executable: ctx.executable,
    mappings: ctx.mappings,
    issues: ctx.issues,
    elementByKey: ctx.elementByKey,
    cacheCandidates: ctx.cacheCandidates,
  };
}

function entriesOf(compiled: CompiledResume, sectionType: SectionType): Array<{ id: string }> {
  if (sectionType === 'education') {
    return compiled.normalized.education;
  }
  if (sectionType === 'project') {
    return compiled.normalized.projects;
  }
  if (sectionType === 'work') {
    return compiled.normalized.work;
  }
  return [];
}
