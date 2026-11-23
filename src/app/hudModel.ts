import type { Registry } from '../content/registry.ts';
import type { BalanceDef } from '../content/schema.ts';
import { t } from '../i18n/i18n.ts';
import { TICK_SECONDS } from '../sim/clock.ts';
import { weakToolParams } from '../sim/mining.ts';
import type { PlayerState } from '../sim/player.ts';
import { thermalStatus } from '../sim/survival.ts';
import type { HudEffect } from '../ui/hud/effects.ts';
import { hintText } from '../ui/hud/hudHint.ts';

/*
 * What the HUD shows that needs the simulation's own rules (pure, so the tests read the same
 * thresholds as the game): the statuses and effects a player has, and the aimed block's line.
 */

/**
 * The statuses and timed effects of a player, most pressing first, written into `out`: the
 * gauges' damage and limits (thresholds from the balance), exhaustion, the timed effects with their
 * seconds left, and the shelter the last sample found.
 */
export function hudEffects(
  player: Readonly<PlayerState>,
  b: BalanceDef,
  out: HudEffect[],
): HudEffect[] {
  out.length = 0;
  const s = player.survival;
  const add = (key: HudEffect['key'], when: boolean) => {
    if (when) out.push({ key, seconds: null });
  };
  const status = thermalStatus(s.temperature, b);
  add('drowning', player.body.headInWater && s.breath === 0);
  add('freezing', status === -2);
  add('overheating', status === 2);
  add('starving', s.hunger === 0);
  add('dehydrated', s.thirst === 0);
  add('poisoned', s.toxicity >= b.toxicity.harmAt);
  add('cold', status === -1);
  add('hot', status === 1);
  add('nauseous', s.toxicity >= b.toxicity.nauseousAt && s.toxicity < b.toxicity.harmAt);
  add('hungry', s.hunger > 0 && s.hunger < b.hunger.lowAt);
  add('thirsty', s.thirst > 0 && s.thirst < b.thirst.lowAt);
  add('exhausted', player.exhausted);
  for (const effect of s.effects)
    out.push({ key: effect.key, seconds: effect.ticks * TICK_SECONDS });
  add('sheltered', s.shelter === 'enclosed');
  add('covered', s.shelter === 'covered');
  return out;
}

/**
 * The aimed block's line: its name, and the hint « Copper pickaxe needed » when the held item
 * (−1: an empty hand) cannot harvest it, or how to sleep on a bedroll (`useKey`: the secondary
 * button's label).
 */
export function targetText(
  registry: Registry,
  state: number,
  itemId: number,
  useKey: string,
): { readonly name: string; readonly hint: string | null } {
  const block = registry.blockDef(state);
  const weak = weakToolParams(registry, state, itemId);
  const hint = weak
    ? hintText('hud.target.needs', weak)
    : block.blockEntity === 'bed'
      ? t('hud.target.sleep', { key: useKey })
      : null;
  return { name: t(block.nameKey), hint };
}
