import type { ActionGuard } from '../contracts/action';
import { throwIfAborted } from '../errors';

export function assertActionAllowed(guard: ActionGuard): void {
  throwIfAborted(guard.signal);
  guard.assertActive?.();
  throwIfAborted(guard.signal);
}
