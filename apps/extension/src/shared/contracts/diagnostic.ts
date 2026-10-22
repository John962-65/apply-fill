export const ACTION_STAGES = ['SCAN', 'MAP', 'FORMAT', 'LOCATE', 'OPEN', 'SEARCH', 'SELECT', 'WAIT_COMMIT', 'VERIFY', 'REANCHOR', 'RECOVER'] as const;
export type ActionStage = typeof ACTION_STAGES[number];

export interface ActionDiagnostic {
  actionStage: ActionStage;
  result: string;
  reason?: string;
  elapsedMs: number;
  domRevisionBefore?: number;
  domRevisionAfter?: number;
}

export interface FieldDiagnostic extends ActionDiagnostic {
  runId: string;
  fieldKey: string;
  sectionType: string;
  controlKind: string;
  label: string;
  mappingSource?: string;
  targetPath?: string;
  wave: string;
  frameId?: number;
}

export type ActionReporter = (diagnostic: ActionDiagnostic) => void;
