import type { FieldExecutionResult, MappingIssue } from '../contracts/field';
import type { RunCounts } from '../contracts/run';

export function executionCounts(fields: FieldExecutionResult[], issues: MappingIssue[] = []): Pick<RunCounts,
  'executed' | 'verified' | 'userOverridden' | 'needsManual' | 'cancelled'> {
  const results = new Map(fields.map((field) => [field.fieldKey, field]));
  const manual = new Set(fields.filter((field) => ['NEEDS_MANUAL', 'RETRYABLE', 'CIRCUIT_BROKEN'].includes(field.status))
    .map((field) => field.fieldKey));
  for (const issue of issues) {
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
