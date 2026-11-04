// Transactional SMS to customers (not sign-in codes; those are in otp.ts).
// Provider and templates come from settings, never from code:
//   SMS_PROVIDER                    'msg91' in production, 'log' (default elsewhere) prints instead
//   MSG91_AUTH_KEY                  shared with OTP
//   MSG91_ORDER_CHANGED_TEMPLATE_ID DLT-approved Flow template with ##shop##, ##code##, ##link##
import { env } from './env';

export type SmsTemplate = 'order_changed';

export interface SmsSender {
  readonly name: string;
  send(phoneE164: string, template: SmsTemplate, vars: Record<string, string>): Promise<void>;
}

/** Development: writes the message to the log instead of sending it. */
export const logSms: SmsSender = {
  name: 'log',
  async send(phone, template, vars) {
    console.info(`[sms:log] to ${phone.slice(0, 5)}••••• ${template} ${JSON.stringify(vars)}`);
  },
};

/** MSG91 Flow API. The template's variables must match the keys sent here. */
export const msg91Sms: SmsSender = {
  name: 'msg91',
  async send(phone, template, vars) {
    const { authKey, templates } = env.smsMsg91();
    const templateId = templates[template];
    if (!templateId) throw new Error(`MSG91 template for ${template} is not configured`);
    const res = await fetch('https://control.msg91.com/api/v5/flow', {
      method: 'POST',
      headers: { authkey: authKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        template_id: templateId,
        short_url: '0',
        recipients: [{ mobiles: phone.replace(/^\+/, ''), ...vars }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`MSG91 SMS failed: ${res.status}`);
  },
};

let override: SmsSender | null = null;
/** Tests swap in a recording sender. */
export function setSmsSenderForTests(s: SmsSender | null) {
  override = s;
}

export function smsSender(): SmsSender {
  if (override) return override;
  return env.smsProvider() === 'msg91' ? msg91Sms : logSms;
}
