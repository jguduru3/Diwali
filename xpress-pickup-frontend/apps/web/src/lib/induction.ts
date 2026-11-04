// Which induction version this phone finished. The server records it again at registration
// (and refuses an old version), so this only decides what to show.
import { INDUCTION_VERSION } from '@pataka/shared';

const KEY = 'pp.induction';

export function inductionPassed(): boolean {
  try {
    return localStorage.getItem(KEY) === INDUCTION_VERSION;
  } catch {
    return false;
  }
}

export function markInductionPassed() {
  try {
    localStorage.setItem(KEY, INDUCTION_VERSION);
  } catch {
    // storage unavailable: they can redo it in a few minutes
  }
}
