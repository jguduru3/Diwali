// Settings that are not hard-coded in screens.
//  - The platform fee comes from the API (/api/ordering → PLATFORM_FEE_PAISE on the server);
//    the shared default is only shown for the moment before that answer arrives.
//  - Build-time settings come from VITE_* variables (see .env.example).
import { PLATFORM_FEE_PAISE } from '@pataka/shared';
import { useOrderingInfo } from './queries';

/** The current platform fee per order, in paise, as the server charges it. */
export function useFeePaise(): number {
  return useOrderingInfo().data?.feePaise ?? PLATFORM_FEE_PAISE;
}

const flag = (v: string | undefined, fallback: boolean) =>
  v === undefined || v === '' ? fallback : v === 'true';

export const settings = {
  /** Company website the footer's "Powered by" line links to. */
  companyUrl:
    (import.meta.env.VITE_COMPANY_URL as string | undefined) || 'https://betteranalytics.in/',
  /** The floating game icon and /play link. */
  gameEnabled: flag(import.meta.env.VITE_GAME_ENABLED as string | undefined, true),
  /** The BEA game, hosted outside this app; the game icon and /play go here. */
  gameUrl:
    (import.meta.env.VITE_GAME_URL as string | undefined) || 'https://bea-game.betteranalytics.in/',
};
