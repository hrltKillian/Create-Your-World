import { t } from '../../i18n/i18n.ts';
import type { Action } from '../../input/bindings.ts';
import { SeenTips, TIPS } from '../../platform/onboarding.ts';
import { HOUR_TICKS, phaseOf } from '../../sim/time.ts';
import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import type { App } from '../App.ts';
import { click, freezeTime, press, setTime, withinFrames } from '../automation.ts';
import { onboardingState, restartOnboarding } from '../onboardingAutomation.ts';
import { setStat } from '../survivalAutomation.ts';
import {
  aimAt,
  assert,
  keepingClock,
  needsFlatPlayer,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  standAt,
} from './support.ts';

/**
 * M11 « Fait quand » browser checks of the onboarding (docs « Prise en main »): the controls card
 * of a first launch with the player's own key labels, closed for good by « Got it »; the tips of
 * the first bag, the first mining, thirst under the level health needs and the first dusk (in
 * place of the sunset banner), each once. Selftests run with onboarding off (app/onboarding.ts
 * `onboardingMode`): each case starts it over in memory, as in a new browser, and turns it off
 * again. The tips case mines the flat world's ground with fixed steps
 * (?worldType=flat&fixedStep=1).
 */

/** Actions whose key labels the card must show. */
const CARD_ACTIONS: readonly Action[] = [
  'forward',
  'left',
  'back',
  'right',
  'jump',
  'primary',
  'secondary',
  'inventory',
];
const CLOSE = '#onboarding-card [data-action="onboarding-close"]';
/** Frames the tip line gets to show a tip (it polls every frame). */
const UI_FRAMES = 30;
/** An hour before the sun sets (« Jour/nuit »: day until 18:30). */
const BEFORE_DUSK = 18;
/** Aim just under the top of the ground block. */
const TOP_AIM = 15 / 16;
const SPOT = { x: 6, z: 6 };

const onboardingOf = (app: App) => {
  const onboarding = app.game?.open?.onboarding;
  assert(onboarding, 'the open world has no onboarding (free camera?)');
  return onboarding;
};

/** Waits until the tip line shows `text`. */
async function tipShows(app: App, text: string, after: string): Promise<void> {
  const shown = await withinFrames(UI_FRAMES, () => onboardingState(app)?.tip === text);
  assert(shown, `after ${after} the tip line reads "${onboardingState(app)?.tip}", not "${text}"`);
}

export const ONBOARDING_CASES: readonly SelftestCase[] = [
  {
    name: "the controls card shows the player's key labels on a first launch; Got it closes it for good",
    scenes: PLAY_SCENES,
    skip: (app) => (app.params.freecam ? 'needs a player (no ?freecam)' : null),
    run: async (app) => {
      await playerSession(app);
      const onboarding = onboardingOf(app);
      const seen = new SeenTips(null);
      try {
        onboarding.start(seen);
        const card = document.querySelector<HTMLElement>('#onboarding-card');
        assert(card && !card.hidden, 'the controls card did not show on a first launch');
        const keys = [...card.querySelectorAll('kbd')].map((key) => key.textContent ?? '');
        for (const action of CARD_ACTIONS) {
          const label = app.input!.keyLabel(action);
          assert(
            keys.includes(label),
            `no « ${label} » (${action}) on the card: ${keys.join(' ')}`,
          );
        }
        assert(click(CLOSE), 'the controls card has no Got it button');
        assert(card.hidden, 'Got it left the controls card open');
        assert(seen.has('controls'), 'closing the card did not mark it seen');
        // The next world of the same browser.
        onboarding.start(seen);
        assert(card.hidden, 'the controls card showed again after Got it');
      } finally {
        onboarding.start(null);
      }
    },
  },
  {
    name: 'the tips show once each: the first bag, mining, thirst under 50, the first dusk (no sunset banner)',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsFlatPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const input = app.input!;
      const inventory = app.inventory!;
      const balance = app.registry!.pack.balance;
      try {
        restartOnboarding(app);
        assert(click(CLOSE), 'the controls card has no Got it button');
        inventory.toggleBag();
        assert(inventory.screen() === 'bag', 'the bag did not open');
        await tipShows(app, t('tip.bag'), 'the first bag');
        inventory.closeScreen();

        await standAt(app, SPOT);
        app.input!.slot = 0;
        await aimAt(app, { x: SPOT.x + 2, y: FLAT_SURFACE, z: SPOT.z }, TOP_AIM);
        press(app, 'primary', 2);
        await tipShows(app, t('tip.mine', { key: input.keyLabel('primary') }), 'the first mining');

        setStat(app, 'thirst', balance.health.regenFedAt - 1);
        const drink = t('tip.drink', { key: input.keyLabel('secondary') });
        await tipShows(app, drink, `thirst set to ${balance.health.regenFedAt - 1}`);

        assert(
          phaseOf(BEFORE_DUSK) === 'day' && phaseOf(BEFORE_DUSK + 1) === 'dusk',
          `the sun does not set between ${BEFORE_DUSK}:00 and ${BEFORE_DUSK + 1}:00`,
        );
        const banner = document.querySelector('#hud-banner');
        assert(banner, 'no #hud-banner');
        banner.classList.remove('play');
        await keepingClock(app, async () => {
          freezeTime(app, false);
          setTime(app, BEFORE_DUSK);
          session.step(HOUR_TICKS);
          await tipShows(app, t('tip.dusk'), 'the first dusk');
          assert(!banner.classList.contains('play'), 'the sunset banner played over the dusk tip');
        });

        // Each tip once: the bag and mining again leave the dusk tip on the line.
        inventory.toggleBag();
        inventory.closeScreen();
        press(app, 'primary', 2);
        await withinFrames(2, () => false);
        const state = onboardingState(app);
        assert(state?.tip === t('tip.dusk'), `a tip showed twice: the line reads "${state?.tip}"`);
        const seen = state.seen.join(', ');
        assert(seen === TIPS.join(', '), `the tips seen are ${seen}, not ${TIPS.join(', ')}`);
      } finally {
        restartOnboarding(app, false);
        setStat(app, 'thirst', balance.thirst.max);
      }
    },
  },
];
