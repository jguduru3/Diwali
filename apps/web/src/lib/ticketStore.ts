// Last ticket kept on the phone so it still opens with no signal at the ground.
import type { Visit } from '@pataka/shared';

const KEY = 'pp.ticket';

export function saveTicket(visit: Visit | null) {
  try {
    if (visit) localStorage.setItem(KEY, JSON.stringify(visit));
    else localStorage.removeItem(KEY);
  } catch {
    // storage unavailable
  }
}

export function loadTicket(): Visit | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Visit) : null;
  } catch {
    return null;
  }
}
