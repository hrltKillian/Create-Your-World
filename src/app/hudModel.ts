import type { Registry } from '../content/registry.ts';
import { t } from '../i18n/i18n.ts';
import { weakToolParams } from '../sim/mining.ts';
import { hintText } from '../ui/hud/hudHint.ts';

/*
 * What the HUD shows that needs the simulation's own rules (pure, so the tests read the same
 * thresholds as the game): the aimed block's line and the biome the player enters.
 */

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

/** Seconds a new biome must stay under the player before its name shows (no flicker on a border). */
export const BIOME_SETTLE_SECONDS = 1;

/**
 * Follows the biome under the player and tells when one is entered (docs « Interface »: the
 * biome's name on entering it). The first biome found is where the player already stands; another
 * one is entered once it has stayed under the player for BIOME_SETTLE_SECONDS.
 */
export class BiomeWatch {
  private current = -1;
  private candidate = -1;
  private held = 0;

  /** The biome under the player now (−1: unknown) after `dt` seconds; the biome entered, or −1. */
  update(biome: number, dt: number): number {
    if (biome < 0) return -1;
    if (this.current < 0 || biome === this.current) {
      this.current = biome;
      this.candidate = -1;
      return -1;
    }
    if (biome !== this.candidate) {
      this.candidate = biome;
      this.held = 0;
    }
    this.held += dt;
    if (this.held < BIOME_SETTLE_SECONDS) return -1;
    this.current = biome;
    this.candidate = -1;
    return biome;
  }
}
