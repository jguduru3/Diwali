import { useEffect } from 'react';
import { api } from './api';

/** A referral code from a shared /r/CODE link, kept until the person is signed in. */
export const PENDING_REFERRAL_KEY = 'pp.ref';

/** After sign-in: claims a remembered referral code once (errors are fine: already referred, own code…). */
export function useClaimPendingReferral(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) return;
    let code: string | null = null;
    try {
      code = localStorage.getItem(PENDING_REFERRAL_KEY);
    } catch {
      return;
    }
    if (!code) return;
    void api('/referrals/claim', { method: 'POST', body: { code } })
      .catch(() => {})
      .finally(() => localStorage.removeItem(PENDING_REFERRAL_KEY));
  }, [signedIn]);
}
