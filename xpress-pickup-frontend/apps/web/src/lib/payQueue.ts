// When one checkout places orders at several shops, each order has its own ₹30 fee payment
// (one fee per shop; G3). This queue remembers the fees still to pay on this phone so the
// customer is taken from one to the next. It holds only order ids and the provider's own
// checkout links — nothing here is trusted: every order changes only by server events.
const KEY = 'pp.payQueue';

export type QueuedFee = { orderId: string; shopName: string; url: string };

function read(): QueuedFee[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as QueuedFee[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(q: QueuedFee[]) {
  try {
    if (q.length) sessionStorage.setItem(KEY, JSON.stringify(q));
    else sessionStorage.removeItem(KEY);
  } catch {
    // storage unavailable: the customer pays the rest from My orders
  }
}

export const setPayQueue = (q: QueuedFee[]) => write(q);
export const payQueue = () => read();

/** Marks this order's fee as handled and returns the next one to pay, if any. */
export function nextAfter(orderId: string): QueuedFee | null {
  const rest = read().filter((f) => f.orderId !== orderId);
  write(rest);
  return rest[0] ?? null;
}

/** The next fee to pay while looking at this order (it may already be paid). */
export function peekNext(orderId: string): QueuedFee | null {
  return read().find((f) => f.orderId !== orderId) ?? null;
}
