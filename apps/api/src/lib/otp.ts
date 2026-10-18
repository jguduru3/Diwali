import { randomInt } from 'node:crypto';
import { env } from './env';

export const DEV_OTP = '123456';
export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;

export interface OtpSender {
  send(phoneE164: string, code: string): Promise<void>;
}

/** Dev: never sends, just logs. The code is always 123456. */
export const devSender: OtpSender = {
  async send(phone, code) {
    console.info(`[otp:dev] ${phone} → ${code}`);
  },
};

/**
 * MSG91 Flow API. Needs a DLT-approved sender + OTP template; the template must
 * contain the variable `otp`. Verify the payload against the MSG91 dashboard before launch.
 */
export const msg91Sender: OtpSender = {
  async send(phone, code) {
    const { authKey, templateId } = env.msg91();
    const res = await fetch('https://control.msg91.com/api/v5/flow', {
      method: 'POST',
      headers: { authkey: authKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        template_id: templateId,
        short_url: '0',
        recipients: [{ mobiles: phone.replace(/^\+/, ''), otp: code }],
      }),
    });
    if (!res.ok) throw new Error(`MSG91 send failed: ${res.status}`);
  },
};

export function generateOtp(): string {
  return env.otpDevMode() ? DEV_OTP : String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function otpSender(): OtpSender {
  return env.otpDevMode() ? devSender : msg91Sender;
}
