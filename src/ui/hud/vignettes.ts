import type { BalanceDef } from '../../content/schema.ts';
import type { SurvivalState } from '../../sim/survival.ts';
import { h } from '../h.ts';

/** Full-screen tints (docs « Interface »): low health, frost, heat, toxicity, under water. */
export const VIGNETTES = ['health', 'cold', 'heat', 'toxicity', 'water'] as const;
export type Vignette = (typeof VIGNETTES)[number];

/** The faintest a vignette shows once its threshold is crossed. */
const FIRST_LEVEL = 0.3;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * How strongly each vignette shows (0–1) for a player's gauges, from the balance's thresholds:
 * health below `lowAt`, Cold and Hot from ±`mildAt` (stronger towards the limit), toxicity from
 * `harmAt`, and the head under water.
 */
export function vignetteLevels(
  s: Readonly<SurvivalState>,
  b: BalanceDef,
  underwater: boolean,
  out: Record<Vignette, number>,
): Record<Vignette, number> {
  const low = b.health.lowAt;
  const t = b.temperature;
  const tox = b.toxicity;
  out.health = s.health < low ? FIRST_LEVEL + (1 - FIRST_LEVEL) * clamp01(1 - s.health / low) : 0;
  out.cold = s.temperature <= -t.mildAt ? clamp01(-s.temperature / t.limit) : 0;
  out.heat = s.temperature >= t.mildAt ? clamp01(s.temperature / t.limit) : 0;
  out.toxicity = s.toxicity >= tox.harmAt ? clamp01(s.toxicity / tox.max) : 0;
  out.water = underwater ? 1 : 0;
  return out;
}

/** The vignette layers, each faded through its `--v` variable (CSS gradients, no filters). */
export class Vignettes {
  readonly element: HTMLElement;
  private readonly layers = new Map<Vignette, HTMLElement>();
  private readonly shown = new Map<Vignette, number>();

  constructor() {
    this.element = h('div', { class: 'vignettes', attrs: { 'aria-hidden': 'true' } });
    for (const kind of VIGNETTES) {
      const layer = h('div', { class: `vignette vignette-${kind}` });
      layer.style.setProperty('--v', '0');
      this.layers.set(kind, layer);
      this.shown.set(kind, 0);
      this.element.append(layer);
    }
  }

  update(levels: Readonly<Record<Vignette, number>>): void {
    for (const kind of VIGNETTES) {
      const level = Math.round(levels[kind] * 50) / 50;
      if (level === this.shown.get(kind)) continue;
      this.shown.set(kind, level);
      this.layers.get(kind)!.style.setProperty('--v', String(level));
    }
  }
}
