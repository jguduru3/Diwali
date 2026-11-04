// Masked calls from a shop to a customer (G9). The provider rings the staff member's phone
// first, then the customer, and joins them; both see only the provider's caller ID, so staff
// never learn the customer's number. Provider and keys come from settings, never from code:
//   CALL_PROVIDER      'exotel' places calls, 'log' (default outside production) prints instead,
//                      'off' (default in production until set) hides the Call button
//   EXOTEL_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN, EXOTEL_CALLER_ID (the ExoPhone customers see),
//   EXOTEL_API_HOST    api.exotel.com (Singapore) or api.in.exotel.com (Mumbai)
import { env } from './env';

export interface CallBridge {
  readonly name: string;
  /** Rings `fromE164` (staff) and, once answered, `toE164` (customer). */
  connect(fromE164: string, toE164: string): Promise<void>;
}

/** Development: writes the call to the log instead of placing it. */
export const logCalls: CallBridge = {
  name: 'log',
  async connect(from, to) {
    console.info(`[call:log] ${from.slice(0, 5)}••••• → ${to.slice(0, 5)}•••••`);
  },
};

/** Exotel "connect two numbers" (REST, no SDK). Indian numbers go in national format. */
export const exotelCalls: CallBridge = {
  name: 'exotel',
  async connect(from, to) {
    const { sid, apiKey, apiToken, callerId, host } = env.exotel();
    const national = (p: string) => (p.startsWith('+91') ? `0${p.slice(3)}` : p);
    const res = await fetch(`https://${host}/v1/Accounts/${sid}/Calls/connect.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${apiKey}:${apiToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({
        From: national(from),
        To: national(to),
        CallerId: callerId,
        CallType: 'trans',
        // a pickup question, not a chat: the provider ends the call after 10 minutes
        TimeLimit: '600',
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Exotel call failed: ${res.status}`);
  },
};

let override: CallBridge | null = null;
/** Tests swap in a recording bridge. */
export function setCallBridgeForTests(c: CallBridge | null) {
  override = c;
}

/** Whether the Call button shows. A bad CALL_PROVIDER hides it (and fails /api/health in prod)
 *  instead of breaking the order screen. */
export function callingAvailable(): boolean {
  try {
    return callBridge() !== null;
  } catch {
    return false;
  }
}

/** The configured bridge, or null when calling is off. Throws when Exotel is chosen without
 *  its keys, so the button stays hidden until they are set. */
export function callBridge(): CallBridge | null {
  if (override) return override;
  const p = env.callProvider();
  if (p === 'exotel') env.exotel();
  return p === 'exotel' ? exotelCalls : p === 'log' ? logCalls : null;
}
