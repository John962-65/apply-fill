import type { ExecutableField } from '@/actuator/FieldExecutionEngine';
import { formatForField } from '@/formatter';
import { buildFieldIdentity } from '@/identity';
import type { MappingMemory } from '@/memory/MappingMemory';
import type { DistilledElement } from '@/perceptor';
import { readFieldValueText } from '@/perceptor';
import type { FingerprintCache, FingerprintInput, ResumeRouteSource } from '@/router';
import { matchRule, resolveResumePath, substituteIndex } from '@/router';
import { fingerprintInputFor } from '@/router/FingerprintCache';
import { entryPathInfo, isOtherPersonContext, isRouteContextValid } from '@/router/RouteContext';
import type { CompiledResume } from '@/shared/contracts/resume';
import { checkPathFillability } from '@/resume/validation/fillability';
import type { FieldMapping, FieldSignature, MappingIssue, SectionType } from '@/shared/contracts/field';
import type { ReanchorStatus } from '@/shared/contracts/reanchor';
import { canonicalFieldLabel } from '@/shared/utils/fieldText';

function highestEducationIndex(entries: Array<{ degree: string }>): number | undefined {
  const ranks: number[] = entries.map((entry) => /博士|doctor|ph\.?d/i.test(entry.degree) ? 4 : /硕士|master/i.test(entry.degree) ? 3 :
    /本科|学士|bachelor/i.test(entry.degree) ? 2 : /专科|大专|associate/i.test(entry.degree) ? 1 : 0);
  const highest = Math.max(0, ...ranks);
  if (entries.length > 1 && ranks.includes(0)) return undefined;
  return highest > 0 ? ranks.indexOf(highest) : entries.length === 1 ? 0 : undefined;
}

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
  compiled: CompiledResume;
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

function mapField(ctx: MappingContext, item: DistilledElement, indexForPath: number, bound = false): void {
  const signature = buildSignature(item);
  if (signature.sectionType === 'basic' && /^(?:最高学历|highest degree)$/.test(canonicalFieldLabel(signature.label))) {
    const highest = highestEducationIndex(ctx.compiled.facts.education.map((entry) => ({ degree: entry.degree?.value ?? '' })));
    if (highest !== undefined) { indexForPath = highest; bound = true; }
  }
  ctx.elementByKey.set(signature.fieldKey, item.element);

  if (signature.disabled) {
    ctx.issues.push({ fieldKey: signature.fieldKey, label: signature.label, kind: 'DISABLED', reason: 'FIELD_DISABLED' });
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
    ctx.issues.push({ fieldKey: signature.fieldKey, label: signature.label, kind: 'READONLY', reason: 'FIELD_READONLY' });
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

  const fingerprintInput = fingerprintInputFor(ctx.host, signature);
  const matchedRule = matchRule(signature.controlKind, signature.descriptor.normalizedLabel, undefined,
    signature.sectionType, signature.descriptor.disambiguator?.groupLabel);
  let cacheHit = ctx.cache?.get(fingerprintInput);
  if (cacheHit && (!isRouteContextValid(cacheHit.targetPathTemplate, signature.sectionType, indexForPath) ||
    isOtherPersonContext(signature.label, signature.descriptor.disambiguator?.groupLabel))) {
    ctx.cache?.invalidate(fingerprintInput);
    cacheHit = undefined;
  }

  let template: string | undefined;
  let source: FieldMapping['source'] = 'rule';
  let confidence = 0;

  if (cacheHit !== undefined) {
    template = cacheHit.targetPathTemplate;
    source = 'cache';
    confidence = 0.9;
  }
  if (template === undefined) {
    const memoryHit = ctx.memory?.lookup({ ...fingerprintInput, ...(bound ? { boundEntryIndex: indexForPath } : {}) });
    if (memoryHit !== undefined) {
      const memoryPath = substituteIndex(memoryHit.targetPath, indexForPath);
      if (isRouteContextValid(memoryHit.targetPath, signature.sectionType, indexForPath) && resolveResumePath(ctx.routeSource, memoryPath).found) {
        template = memoryHit.targetPath;
        source = 'memory';
        confidence = memoryHit.source === 'user' ? 0.92 : 0.88;
      }
    }
  }

  if (template === undefined) {
    if (matchedRule !== undefined) {
      template = matchedRule.targetPath;
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

  if (template === 'projects[{index}].description') {
    const limit = signature.constraints?.maxLength;
    if (limit !== undefined && limit <= 150 && limit > 0) {
      template = limit <= 50 ? 'projections.projects[{index}].one_liner' : 'projections.projects[{index}].summary_150';
    }
  }

  const targetPath = substituteIndex(template, indexForPath);
  if (!isRouteContextValid(template, signature.sectionType, indexForPath) ||
    (source === 'llm' && isOtherPersonContext(signature.label, signature.descriptor.disambiguator?.groupLabel))) {
    ctx.mappings.push({ fieldKey: signature.fieldKey, signature, targetPath, source, confidence, status: 'AMBIGUOUS', reason: 'ROUTE_CONTEXT_MISMATCH' });
    ctx.issues.push({ fieldKey: signature.fieldKey, label: signature.label, kind: 'AMBIGUOUS', reason: 'ROUTE_CONTEXT_MISMATCH' });
    return;
  }
  const entry = entryPathInfo(template);
  if (!bound && entry && ctx.routeSource.normalized[entry.collection].length > 1) {
    const reason = 'RESUME_ENTRY_REQUIRES_CONFIRMATION';
    ctx.mappings.push({ fieldKey: signature.fieldKey, signature, targetPath, source, confidence, status: 'AMBIGUOUS', reason });
    ctx.issues.push({ fieldKey: signature.fieldKey, label: signature.label, kind: 'AMBIGUOUS', reason });
    return;
  }
  if (signature.sectionType === 'essay' || (matchedRule === undefined && (signature.controlKind === 'textarea' ||
    targetPath === 'basic.intro' || targetPath === 'projections.introShort'))) {
    ctx.mappings.push({ fieldKey: signature.fieldKey, signature, targetPath, source, confidence, status: 'AMBIGUOUS', reason: 'DRAFT_REQUIRES_CONFIRMATION' });
    ctx.issues.push({ fieldKey: signature.fieldKey, label: signature.label, kind: 'AMBIGUOUS', reason: 'DRAFT_REQUIRES_CONFIRMATION' });
    return;
  }
  if (source === 'llm' && /^(?:basic\.(?:name|phone|email|birthDate|location|city|idExplanation)|preferences\.expectedSalary)$/.test(targetPath)) {
    ctx.mappings.push({ fieldKey: signature.fieldKey, signature, targetPath, source, confidence, status: 'AMBIGUOUS', reason: 'LLM_SENSITIVE_REQUIRES_CONFIRMATION' });
    ctx.issues.push({ fieldKey: signature.fieldKey, label: signature.label, kind: 'AMBIGUOUS', reason: 'LLM_SENSITIVE_REQUIRES_CONFIRMATION' });
    return;
  }
  const fillability = checkPathFillability(ctx.compiled, targetPath, signature);
  if (!fillability.ok) {
    const reason = fillability.reason === 'FACT_NOT_CONFIRMED' ? 'FACT_NOT_CONFIRMED' :
      fillability.reason === 'FACT_REJECTED' ? 'FACT_REJECTED' :
      fillability.reason === 'DATE_PRECISION_INSUFFICIENT' ? 'DATE_PRECISION_INSUFFICIENT' :
      fillability.reason === 'TYPE_MISMATCH' ? 'FACT_TYPE_MISMATCH' :
      fillability.reason === 'DERIVED_TEXT_INVALID' ? 'DERIVED_TEXT_INVALID' :
      'RESUME_VALUE_MISSING';
    ctx.issues.push({ label: signature.label, kind: 'NO_DATA', reason, fieldKey: signature.fieldKey });
    ctx.mappings.push({
      fieldKey: signature.fieldKey,
      signature,
      targetPath,
      status: 'NO_DATA',
      source,
      confidence,
      reason,
    });
    return;
  }

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
    compiled,
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
      mapField(ctx, item, indexForPath, true);
    }
  }

  // Keep optional and populated controls in the report without making them mandatory tasks.
  for (const issue of ctx.issues) {
    const mapping = ctx.mappings.find((entry) => entry.fieldKey === issue.fieldKey);
    const element = issue.fieldKey ? ctx.elementByKey.get(issue.fieldKey) : undefined;
    if (!mapping?.signature.requirement || !element) continue;
    const current = readFieldValueText(element).trim();
    const populated = mapping.signature.controlKind === 'checkbox'
      ? element instanceof HTMLInputElement && element.checked : current !== '' && current !== 'false';
    const emptyCollection = ['education', 'project', 'work'].includes(mapping.signature.sectionType) && entriesOf(ctx.compiled, mapping.signature.sectionType).length === 0;
    issue.attention = populated ? 'filled' : issue.kind === 'DISABLED' || issue.kind === 'READONLY' ? 'unavailable' :
      mapping.signature.requirement === 'optional' && (issue.kind !== 'AMBIGUOUS' || emptyCollection) ? 'optional' : 'manual';
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
