import type { FieldStatus } from './field';
import type { MappingIssue } from './field';

export interface ResumePathOption {
  path: string;
  label: string;
  preview: string;
}

export interface PillFieldView {
  fieldKey: string;
  label: string;
  status: FieldStatus;
  reason: string;
  targetPreview: string;
  requiresSource?: boolean;
  essay?: boolean;
  maxLength?: number;
  attention?: MappingIssue['attention'];
}

export interface EssayDraft {
  draft: string;
  source: string;
}

export interface QuickFillPillActions {
  onRetry(fieldKey: string): void;
  onCopy(fieldKey: string): void;
  onListAlternatives(fieldKey: string): Promise<ResumePathOption[]>;
  onRemap(fieldKey: string, path: string): void;
  onSkip(fieldKey: string): void;
  onMarkChecked(fieldKey: string): void;
  onFocusField(fieldKey: string): void;
  onGenerateEssay(fieldKey: string, projectionPath?: string): Promise<EssayDraft | undefined>;
  onApplyEssay(fieldKey: string, text: string): Promise<boolean>;
}

export interface QuickFillPillController {
  setFields(fields: PillFieldView[]): void;
  destroy(): void;
}
