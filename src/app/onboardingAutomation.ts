import { SeenTips, type Tip } from '../platform/onboarding.ts';
import type { App } from './App.ts';

/**
 * Onboarding automation (M11) for the debug hook and the selftests: what the controls card and the
 * tip line show, and starting them over as in a new browser (selftests and Playwright run with
 * onboarding off: app/onboarding.ts `onboardingMode`).
 */

/** What the onboarding shows, as automation reads it. */
export interface OnboardingView {
  /** Whether the card and the tips may show. */
  readonly on: boolean;
  /** The controls card is open. */
  readonly card: boolean;
  /** The tip on screen, or null. */
  readonly tip: string | null;
  /** The card and the tips already shown, in order of `TIPS`. */
  readonly seen: readonly Tip[];
}

/** The onboarding of the open world (null without one, or with the free camera). */
export function onboardingState(app: App): OnboardingView | null {
  const onboarding = app.game?.open?.onboarding;
  if (!onboarding) return null;
  const tip = onboarding.tip.element;
  return {
    on: onboarding.isOn(),
    card: onboarding.card.isOpen(),
    tip: tip.hidden ? null : tip.textContent,
    seen: onboarding.seenTips(),
  };
}

/**
 * Starts the onboarding over with nothing seen (kept in memory only: the player's own store is
 * left alone), which shows the controls card; `on = false` turns it off. Returns the new state.
 */
export function restartOnboarding(app: App, on = true): OnboardingView | null {
  app.game?.open?.onboarding?.start(on ? new SeenTips(null) : null);
  return onboardingState(app);
}
