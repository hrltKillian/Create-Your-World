import { GAIT_LEGS, type ModelDef } from '../content/schema.ts';
import type { CreatureMode } from '../sim/creatures.ts';

/*
 * Procedural animation of the creatures' box models (docs « Animation »): the legs of each gait
 * swing by the distance walked (the model's `stride` in radians per block, legs of a half-cycle
 * together: GAIT_LEGS), the body breathes, the head nods with the steps and looks at the
 * creature's target, the wind-up
 * raises the head and opens the jaw, a charge lowers the head, a stunned creature droops; a hit
 * makes it flinch, flash red and freeze for 80 ms. Parts the renderer animates by name: the legs,
 * `body`, `head`, `tail` and the jaws (`OPENING`). Positive angles tilt a part's front down.
 */

/** Seconds a hit freezes the pose, and the red flash fades. */
export const HIT_FREEZE = 0.08;
export const FLASH_SECONDS = 0.3;
/** Parts that open on the wind-up. */
const OPENING = ['jaw', 'mandL', 'mandR'] as const;
/** Largest head tilt towards a target (radians). */
const LOOK_LIMIT = 0.6;

/** Animation state of one creature, kept on the render side. */
export interface CreatureRig {
  /** Walk cycle phase (radians) and leg swing amplitude (radians, eased). */
  phase: number;
  amplitude: number;
  /** Seconds of breathing. */
  time: number;
  /** Blend (0–1) towards the wind-up pose, eased. */
  windup: number;
  /** Head tilt towards the target (radians, eased). */
  look: number;
  /** Red flash (1 at a hit, fades to 0) and seconds of hit freeze left. */
  flash: number;
  freeze: number;
  readonly angles: Record<string, number>;
  /** Height of the drawn head pivot (poseModel). */
  headPivotY: number;
}

export function createCreatureRig(): CreatureRig {
  return {
    phase: 0,
    amplitude: 0,
    time: 0,
    windup: 0,
    look: 0,
    flash: 0,
    freeze: 0,
    angles: {},
    headPivotY: 0,
  };
}

/** What a creature does this frame. */
export interface CreatureMotion {
  /** Horizontal distance moved since the last frame (blocks). */
  readonly distance: number;
  /** Horizontal speed (blocks per second). */
  readonly speed: number;
  readonly mode: CreatureMode;
  /** Tilt that would point its head at its target (radians, positive looks down); 0 for none. */
  readonly look: number;
  readonly dt: number;
}

/** A hit: the creature flinches, flashes red and freezes for HIT_FREEZE. */
export function hitCreatureRig(rig: CreatureRig): void {
  rig.flash = 1;
  rig.freeze = HIT_FREEZE;
}

/** Eases `from` towards `to` at `rate` per second. */
function ease(from: number, to: number, rate: number, dt: number): number {
  return from + (to - from) * Math.min(1, dt * rate);
}

/** One frame of a creature's animation: sets the angles of its model's parts. */
export function animateCreature(rig: CreatureRig, model: ModelDef, motion: CreatureMotion): void {
  const dt = motion.dt;
  rig.flash = Math.max(0, rig.flash - dt / FLASH_SECONDS);
  if (rig.freeze > 0) {
    rig.freeze -= dt;
    return;
  }
  rig.time += dt;
  rig.phase += motion.distance * model.stride;
  const moving = motion.speed > 0.2 ? Math.min(0.9, 0.35 + motion.speed * 0.08) : 0;
  rig.amplitude = ease(rig.amplitude, moving, 8, dt);
  rig.windup = ease(rig.windup, motion.mode === 'windup' ? 1 : 0, 12, dt);
  const look = Math.max(-LOOK_LIMIT, Math.min(LOOK_LIMIT, motion.look));
  rig.look = ease(rig.look, look, 6, dt);
  const a = rig.angles;
  const legs = GAIT_LEGS[model.gait];
  for (const name in legs) a[name] = Math.sin(rig.phase + legs[name]! * Math.PI) * rig.amplitude;
  const w = rig.windup;
  // Breathing, leaning back on the wind-up, rearing at a hit.
  a.body = Math.sin(rig.time * 2) * 0.025 - 0.12 * w - 0.25 * rig.flash;
  // The head nods with each step (twice a gait cycle), as much as the legs swing.
  let head = rig.look - 0.45 * w + Math.sin(rig.phase * 2) * 0.08 * rig.amplitude;
  if (motion.mode === 'charge') head += 0.35;
  else if (motion.mode === 'stunned') head += 0.5 + Math.sin(rig.time * 9) * 0.1;
  a.head = head;
  a.tail = Math.sin(rig.time * 3) * 0.12 + rig.amplitude * 0.3;
  for (let i = 0; i < OPENING.length; i++) a[OPENING[i]!] = 0.6 * w;
}
