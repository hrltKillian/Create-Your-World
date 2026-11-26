import { GAIT_LEGS, type ModelDef } from '../content/schema.ts';
import type { CreatureMode } from '../sim/creatures.ts';

/*
 * Procedural animation of the creatures' box models (docs « Animation »): the legs of each gait
 * swing by the distance walked (the model's `stride` in radians per block, legs of a half-cycle
 * together: GAIT_LEGS) and fold at the knee as they come forward (`SHINS`), the body breathes and
 * rocks with the steps, the head nods, turns to the creature's target and glances about at rest,
 * grazers lower the neck now and then and chew, ears twitch, prick up when watching and flatten
 * when fleeing, tails wag in a wave down their segments, wings spread and spines rise on a threat
 * (plan v5 « M52 »). The wind-up raises the head and opens the jaw, a charge lowers the head, a
 * stunned creature droops; a hit makes it flinch, flash red and freeze for 80 ms. Parts the
 * renderer animates by name: the legs and shins, `body`, `neck`, `head`, `jaw` and `mandL`/`mandR`,
 * `earL`/`earR`, `tail` to `tail3`, `wingL`/`wingR`, `antL`/`antR` and `crest`. Positive angles
 * tilt a part's front down; positive yaws turn it left.
 */

/** Seconds a hit freezes the pose, and the red flash fades. */
export const HIT_FREEZE = 0.08;
export const FLASH_SECONDS = 0.3;
/** Largest head tilt towards a target, and its largest turn (radians). */
const LOOK_LIMIT = 0.6;
const TURN_LIMIT = 0.8;
/**
 * The lower segment of each leg and how it folds as the leg comes forward: knees fold back, the
 * hind legs' hocks forward (the reference animals'), a bird's ankle back.
 */
const SHINS: Readonly<Record<string, readonly [string, number]>> = {
  legL: ['shinL', 1],
  legR: ['shinR', 1],
  legFL: ['shinFL', 1],
  legFR: ['shinFR', 1],
  legML: ['shinML', 1],
  legMR: ['shinMR', 1],
  legBL: ['shinBL', -1],
  legBR: ['shinBR', -1],
};
/** How far a knee folds at the full swing, and the tail's segments down their wave. */
const KNEE = 1.1;
const TAILS = ['tail', 'tail2', 'tail3'] as const;

/** Animation state of one creature, kept on the render side. */
export interface CreatureRig {
  /** Walk cycle phase (radians) and leg swing amplitude (radians, eased). */
  phase: number;
  amplitude: number;
  /** Seconds of breathing. */
  time: number;
  /** Its own offset in the idle cycles (radians), so a herd never moves as one. */
  readonly seed: number;
  /** Blend (0–1) towards the wind-up pose, eased. */
  windup: number;
  /** Head tilt and turn towards the target or a glance (radians, eased). */
  look: number;
  turn: number;
  /** Blend (0–1) of the neck lowered to graze, and of a threat shown (ears, wings, spines). */
  graze: number;
  alarm: number;
  /** Red flash (1 at a hit, fades to 0) and seconds of hit freeze left. */
  flash: number;
  freeze: number;
  readonly angles: Record<string, number>;
  readonly yaws: Record<string, number>;
  /** Height of the drawn head pivot (poseModel). */
  headPivotY: number;
}

/** `seed`: any number of the creature's own (its id); it spreads the idle cycles. */
export function createCreatureRig(seed = 0): CreatureRig {
  return {
    phase: 0,
    amplitude: 0,
    time: 0,
    seed: (seed * 2.399963) % (2 * Math.PI),
    windup: 0,
    look: 0,
    turn: 0,
    graze: 0,
    alarm: 0,
    flash: 0,
    freeze: 0,
    angles: {},
    yaws: {},
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
  /** Turn from its facing to its target (radians, positive to the left); 0 for none. */
  readonly turn: number;
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

/** A short pulse (0–1) once a period of `2π / rate` seconds, at its own phase. */
function pulse(time: number, rate: number, phase: number): number {
  const s = Math.max(0, Math.sin(time * rate + phase));
  const s2 = s * s;
  const s4 = s2 * s2;
  return s4 * s4 * s4;
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
  const mode = motion.mode;
  const t = rig.time;
  const seed = rig.seed;
  const moving = motion.speed > 0.2 ? Math.min(0.9, 0.35 + motion.speed * 0.08) : 0;
  rig.amplitude = ease(rig.amplitude, moving, 8, dt);
  rig.windup = ease(rig.windup, mode === 'windup' ? 1 : 0, 12, dt);
  const threat = mode === 'watch' || mode === 'windup' || mode === 'charge' || mode === 'chase';
  rig.alarm = ease(rig.alarm, threat ? 1 : 0, 6, dt);
  // At rest a grazer's neck goes down to the ground now and then.
  const resting = mode === 'idle' && moving === 0;
  rig.graze = ease(rig.graze, resting && Math.sin(t * 0.31 + seed) > 0.45 ? 1 : 0, 2.5, dt);
  const look = Math.max(-LOOK_LIMIT, Math.min(LOOK_LIMIT, motion.look));
  rig.look = ease(rig.look, look, 6, dt);
  // The head turns to a target, else glances about while still.
  const glance = resting ? 0.45 * Math.sin(t * 0.37 + seed) * Math.sin(t * 0.21 + 2 * seed) : 0;
  const turn =
    motion.turn !== 0 ? Math.max(-TURN_LIMIT, Math.min(TURN_LIMIT, motion.turn)) : glance;
  rig.turn = ease(rig.turn, turn, 5, dt);
  const a = rig.angles;
  const y = rig.yaws;
  const amp = rig.amplitude;
  const legs = GAIT_LEGS[model.gait];
  for (const name in legs) {
    const at = rig.phase + legs[name]! * Math.PI;
    a[name] = Math.sin(at) * amp;
    // A leg folds while it swings forward (its angle falling).
    const shin = SHINS[name];
    if (shin) a[shin[0]] = shin[1] * Math.max(0, -Math.cos(at)) * amp * KNEE;
  }
  const w = rig.windup;
  // Breathing, rocking with the steps, leaning back on the wind-up, rearing at a hit.
  a.body =
    Math.sin(t * 2 + seed) * 0.025 +
    Math.sin(rig.phase * 2) * 0.04 * amp -
    0.12 * w -
    0.25 * rig.flash;
  a.neck = 0.85 * rig.graze;
  // The head nods with each step (twice a gait cycle), as much as the legs swing.
  let head = rig.look - 0.45 * w + Math.sin(rig.phase * 2) * 0.08 * amp + 0.3 * rig.graze;
  if (mode === 'charge') head += 0.35;
  else if (mode === 'stunned') head += 0.5 + Math.sin(t * 9) * 0.1;
  a.head = head;
  y.head = rig.turn;
  // Ears: a twitch now and then, pricked forward on a threat, flat back in flight.
  const flat = mode === 'flee' ? 0.7 : 0;
  a.earL = -0.5 * pulse(t, 1.1, seed) + 0.25 * rig.alarm - flat;
  a.earR = -0.5 * pulse(t, 0.9, seed + 1.7) + 0.25 * rig.alarm - flat;
  // The tail sways in a wave down its segments, faster and wider when roused or running.
  const lash = 1 + 1.5 * rig.alarm + amp;
  for (let i = 0; i < TAILS.length; i++) {
    const name = TAILS[i]!;
    a[name] = (i === 0 ? Math.sin(t * 3 + seed) * 0.12 + amp * 0.3 : 0) - 0.1 * i * rig.alarm;
    y[name] = Math.sin(t * 1.6 * lash + seed - i * 0.7) * 0.18 * (1 + i * 0.4) * Math.min(lash, 2);
  }
  // Wings spread and spines rise on a threat; feelers sway.
  y.wingL = -0.7 * rig.alarm;
  y.wingR = 0.7 * rig.alarm;
  a.crest = -0.35 * rig.alarm;
  y.antL = Math.sin(t * 4.3 + seed) * 0.25;
  y.antR = Math.sin(t * 3.7 + seed + 1) * 0.25;
  // Jaws open on the wind-up, chew while grazing and click now and then; mandibles part sideways.
  const open =
    0.6 * w + Math.max(0, Math.sin(t * 9)) * 0.18 * rig.graze + pulse(t, 2.3, seed) * 0.2;
  a.jaw = open;
  y.mandL = open;
  y.mandR = -open;
}
