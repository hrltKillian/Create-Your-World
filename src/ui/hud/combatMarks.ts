import { h } from '../h.ts';
import { bearingOf, headingOf } from './compass.ts';
import { replay } from './flash.ts';

/** Damage arcs shown at once (a new blow reuses the oldest). */
const ARCS = 4;

/**
 * Where a blow struck from (x, z) comes from, seen by a player at (px, pz) looking along `yaw`:
 * radians clockwise from straight ahead, in [−π, π] (π/2 on the right, −π/2 on the left).
 */
export function damageBearing(px: number, pz: number, yaw: number, x: number, z: number): number {
  const d = bearingOf(x - px, z - pz) - headingOf(yaw);
  return d - Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
}

/**
 * Combat feedback around the crosshair (docs « Combat »): a hit marker when the player's blow
 * lands, and an arc on the side a blow came from, both fading out (CSS animations).
 */
export class CombatMarks {
  readonly element: HTMLElement;
  private readonly marker: HTMLElement;
  private readonly arcs: HTMLElement[] = [];
  private next = 0;

  constructor() {
    this.marker = h('div', { id: 'hud-hit', class: 'hit-marker' });
    for (let i = 0; i < ARCS; i++) this.arcs.push(h('div', { class: 'damage-arc' }));
    this.element = h(
      'div',
      { id: 'hud-damage', class: 'combat-marks', attrs: { 'aria-hidden': 'true' } },
      this.marker,
      ...this.arcs,
    );
  }

  /** The player's blow landed. */
  hit(): void {
    replay(this.marker);
  }

  /** A blow struck the player from `bearing` (damageBearing). */
  hurt(bearing: number): void {
    const arc = this.arcs[this.next]!;
    this.next = (this.next + 1) % ARCS;
    arc.style.setProperty('--a', `${bearing}rad`);
    replay(arc);
  }
}
