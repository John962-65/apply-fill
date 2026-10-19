export interface ActionGuard {
  signal?: AbortSignal;
  assertActive?: () => void;
}
