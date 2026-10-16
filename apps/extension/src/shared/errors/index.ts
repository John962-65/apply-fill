export type ExecutionFailureKind =
  | 'ABORTED'
  | 'USER_INTERRUPTED'
  | 'PROTECTED'
  | 'LEASE_CONFLICT'
  | 'LEASE_REVOKED'
  | 'LEASE_EXPIRED'
  | 'IDENTITY_LOST'
  | 'COMMIT_NOT_CONFIRMED'
  | 'ACTUATOR_ERROR'
  | 'BUDGET_EXCEEDED'
  | 'RUN_IN_PROGRESS'
  | 'UNKNOWN';

export class ApplyFillError extends Error {
  readonly kind: ExecutionFailureKind;

  constructor(message: string, kind: ExecutionFailureKind) {
    super(message);
    this.name = 'ApplyFillError';
    this.kind = kind;
  }
}

export function classifyExecutionError(error: unknown): ExecutionFailureKind {
  if (error instanceof ApplyFillError) {
    return error.kind;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'ABORTED';
  }
  return 'UNKNOWN';
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new ApplyFillError('operation aborted', 'ABORTED');
  }
}
