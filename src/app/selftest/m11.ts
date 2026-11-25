import { BOT_CASES } from './botCases.ts';
import { M11_AUDIO_CASES } from './m11audio.ts';
import { FEEL_CASES } from './m11feel.ts';
import { M11_PERF_CASES } from './m11perf.ts';
import { SETTINGS_CASES } from './m11settings.ts';
import { ONBOARDING_CASES } from './onboardingCases.ts';
import { QUESTS_WALK_CASES } from './questsWalk.ts';
import { noErrorsCase, type SelftestCase } from './support.ts';

/**
 * M11 « Finition et performance » browser checks; each case skips outside its setup:
 * - the quests walk: the generated world with fixed steps (?seed=7&rd=4&fixedStep=1), first
 *   (a player who has done quests, after m9 under ?selftest=all, walks in a new world);
 * - the onboarding card: any world with a player; its tips: ?worldType=flat&fixedStep=1;
 * - audio: ?worldType=arena&fixedStep=1; the render feel and the settings (rebinding through the
 *   screens, live graphics switches): ?worldType=flat&fixedStep=1;
 * - performance: the generated world with real ticks (?seed=7&rd=6), `fly` with &freecam=1;
 *   frame-time thresholds on the bench build only;
 * - the wanderMineBuild bot: the generated world, fixed steps or real ticks, last (it leaves the
 *   player elsewhere).
 */
export const M11_SUITE: readonly SelftestCase[] = [
  ...QUESTS_WALK_CASES,
  ...ONBOARDING_CASES,
  ...M11_AUDIO_CASES,
  ...FEEL_CASES,
  ...M11_PERF_CASES,
  ...SETTINGS_CASES,
  ...BOT_CASES,
  noErrorsCase('no errors after the m11 checks'),
];
