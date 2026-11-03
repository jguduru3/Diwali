import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { codeSchema } from '@pataka/shared';
import { useMe } from '../../auth/useAuth';
import { api } from '../../lib/api';

import { PENDING_REFERRAL_KEY } from '../../lib/referral';

/**
 * /r/CODE: remembers who shared the link and goes to the shops. The code is claimed once the
 * person is signed in (here, or after sign-in from the account menu). It never gates access.
 */
export function ReferralLanding() {
  const raw = useParams().code ?? '';
  const code = codeSchema.safeParse(raw);
  const { data: me } = useMe();
  useEffect(() => {
    if (!code.success) return;
    try {
      localStorage.setItem(PENDING_REFERRAL_KEY, code.data);
    } catch {
      // storage unavailable: the code can still be typed on My credit
    }
    // one visit per link per browser per day for the influencer's stats
    const seen = `dx.visit.${code.data}.${new Date().toISOString().slice(0, 10)}`;
    let first = true;
    try {
      first = !localStorage.getItem(seen);
      localStorage.setItem(seen, '1');
    } catch {
      // storage unavailable: count it
    }
    if (first) void api(`/r/${code.data}/visit`, { method: 'POST' }).catch(() => {});
    if (me) {
      void api('/referrals/claim', { method: 'POST', body: { code: code.data } })
        .catch(() => {})
        .finally(() => localStorage.removeItem(PENDING_REFERRAL_KEY));
    }
  }, [code.success, code.data, me]);
  return <Navigate to="/" replace />;
}
