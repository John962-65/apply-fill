import type { FieldExecutionResult, MappingIssue } from '../contracts/field';
import type { RunCounts } from '../contracts/run';
import type { RunSummary } from '../contracts/run';

export function completionStatus(summary: Pick<RunSummary, 'status' | 'counts' | 'mappingIssues' | 'dirty' | 'frames'>): RunSummary['status'] {
  if (summary.status !== 'COMPLETED' && summary.status !== 'PARTIAL') return summary.status;
  return summary.counts.needsManual > 0 || summary.mappingIssues.some((issue) => !issue.fieldKey && issueNeedsAttention(issue)) ||
    (summary.dirty?.newRequired?.length ?? 0) > 0 || summary.frames?.some((frame) => frame.status === 'PARTIAL' || frame.status === 'NEEDS_MANUAL')
    ? 'PARTIAL' : 'COMPLETED';
}

export function issueNeedsAttention(issue: MappingIssue): boolean {
  if (issue.kind === 'DISABLED' || issue.kind === 'READONLY') return false;
  return issue.attention === undefined || issue.attention === 'manual';
}

export function executionCounts(fields: FieldExecutionResult[], issues: MappingIssue[] = []): Pick<RunCounts,
  'executed' | 'verified' | 'userOverridden' | 'needsManual' | 'cancelled'> {
  const results = new Map(fields.map((field) => [field.fieldKey, field]));
  const manual = new Set(fields.filter((field) => ['NEEDS_MANUAL', 'RETRYABLE', 'CIRCUIT_BROKEN'].includes(field.status))
    .map((field) => field.fieldKey));
  for (const issue of issues) {
    if (!issueNeedsAttention(issue)) continue;
    if (!issue.fieldKey) continue;
    const result = results.get(issue.fieldKey);
    if (!result || !['VERIFIED', 'USER_OVERRIDDEN', 'CANCELLED'].includes(result.status)) manual.add(issue.fieldKey);
  }
  return {
    executed: fields.filter((field) => field.attempts > 0).length,
    verified: fields.filter((field) => field.status === 'VERIFIED').length,
    userOverridden: fields.filter((field) => field.status === 'USER_OVERRIDDEN').length,
    needsManual: manual.size,
    cancelled: fields.filter((field) => field.status === 'CANCELLED').length,
  };
}

export function mappingIssueText(issue: MappingIssue): string {
  if (issue.attention === 'filled') return '页面已有内容，未自动改动';
  if (issue.attention === 'unavailable') return '当前不可编辑，已跳过';
  if (issue.attention === 'optional') return '选填项，未自动填写，可按需补充';
  if (issue.reason === 'FACT_NOT_CONFIRMED') return '请在工作台确认这项简历资料后重试';
  if (issue.reason === 'DATE_PRECISION_INSUFFICIENT' || issue.reason === 'INSUFFICIENT_DATE_PRECISION') return '简历未提供此日期精度，请按实际情况补充';
  if (issue.reason === 'RESUME_ENTRY_REQUIRES_CONFIRMATION') return '有多段候选经历，请在页面浮层中选择来源';
  if (issue.reason === 'EXPAND_SECTION_AMBIGUOUS') return '有多个添加入口，请先手动添加所需条目';
  if (issue.reason === 'DRAFT_REQUIRES_CONFIRMATION') return '请先审核文本或选择来源';
  if (issue.reason === 'LLM_SENSITIVE_REQUIRES_CONFIRMATION') return '请确认个人资料来源后填写';
  if (issue.kind === 'UNMAPPED') return '未确定来源，请在页面浮层中选择';
  if (issue.kind === 'NO_DATA') return '简历中缺少对应资料，请补充后重试';
  if (issue.kind === 'NO_OPTION') return '页面没有匹配选项，请人工核对';
  if (issue.kind === 'DISABLED') return '当前控件不可用';
  if (issue.kind === 'READONLY') return '当前控件只读';
  if (issue.kind === 'REPEATER') return '经历条目未能补足，请手动添加后重试';
  return '来源或经历身份存在歧义，请人工确认';
}
