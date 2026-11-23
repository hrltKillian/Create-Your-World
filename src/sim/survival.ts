import type { BalanceDef } from '../content/schema.ts';
import { TICK_SECONDS, TICKS_PER_SECOND, ticksOf } from './clock.ts';
import { type Contact, sampleEnvironment, touch } from './environment.ts';
import { wearFilters } from './equipment.ts';
import type { SimEvent } from './events.ts';
import type { Simulation } from './Simulation.ts';
import type { Shelter } from './shelter.ts';

/*
 * Survival gauges (docs « Survie »): health, hunger, thirst, temperature, toxicity and breath, the
 * damage they deal and the cause of a death. All rates come from the pack's balance; the gauges
 * move every tick (tick step 11), the environment they react to is sampled every
 * `shelter.checkSec` (environment.ts). Zero allocation per tick.
 */

/** What took a player's last health (the death screen shows `death.cause.<cause>`). */
export type DeathCause =
  | 'starvation'
  | 'dehydration'
  | 'cold'
  | 'heat'
  | 'toxicity'
  | 'drowning'
  | 'fall'
  | 'contact';
export const DEATH_CAUSES: readonly DeathCause[] = [
  'starvation',
  'dehydration',
  'cold',
  'heat',
  'toxicity',
  'drowning',
  'fall',
  'contact',
];

/** Timed effects (docs « Mort »): Weakened after a respawn, Untargeted for its first seconds. */
export type EffectKey = 'weakened' | 'untargeted';
export const EFFECT_KEYS: readonly EffectKey[] = ['weakened', 'untargeted'];

export interface TimedEffect {
  key: EffectKey;
  /** Ticks left. */
  ticks: number;
}

/** A player's survival state: plain data, hashed and saved whole. */
export interface SurvivalState {
  health: number;
  hunger: number;
  thirst: number;
  /** −limit…+limit; drifts towards `target`. */
  temperature: number;
  toxicity: number;
  /** Seconds of air left. */
  breath: number;
  /** Ticks since the last damage (regeneration waits `health.regenDelaySec`). */
  calmTicks: number;
  /** Stamina spent since the last survival step (it costs hunger). */
  staminaSpent: number;
  /** What hurt last: the cause of death once health is 0 ('' before any damage). */
  cause: DeathCause | '';
  /** The death was handled (sim/death.ts): the pack is left, the player waits to respawn. */
  dead: boolean;
  effects: TimedEffect[];
  /** The last environment sample (environment.ts): shelter, felt °C and the gauge's target. */
  shelter: Shelter;
  ambient: number;
  target: number;
  /** Toxicity per minute of the air (biome, shelter, filter mask). */
  airToxicity: number;
  /** Ticks before the next environment sample (1: the next tick). */
  sampleTicks: number;
}

/** Full gauges, comfortable, the environment sampled on the first tick. */
export function createSurvival(b: BalanceDef): SurvivalState {
  return {
    health: b.health.max,
    hunger: b.hunger.max,
    thirst: b.thirst.max,
    temperature: 0,
    toxicity: 0,
    breath: b.breath.seconds,
    calmTicks: ticksOf(b.health.regenDelaySec),
    staminaSpent: 0,
    cause: '',
    dead: false,
    effects: [],
    shelter: 'exposed',
    ambient: b.climate.comfortMinC,
    target: 0,
    airToxicity: 0,
    sampleTicks: 1,
  };
}

const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));

/**
 * Adds to the gauges (negative amounts take away), each kept within its range: what food, drinks,
 * sips and a night's sleep do.
 */
export function adjustGauges(
  s: SurvivalState,
  b: BalanceDef,
  hunger: number,
  thirst: number,
  health: number,
  toxicity: number,
): void {
  s.hunger = clamp(s.hunger + hunger, b.hunger.max);
  s.thirst = clamp(s.thirst + thirst, b.thirst.max);
  s.health = clamp(s.health + health, b.health.max);
  s.toxicity = clamp(s.toxicity + toxicity, b.toxicity.max);
}

/** Takes health for a cause (nothing once dead). */
export function hurt(s: SurvivalState, amount: number, cause: DeathCause): void {
  if (amount <= 0 || s.health <= 0) return;
  s.health = Math.max(0, s.health - amount);
  s.cause = cause;
  s.calmTicks = 0;
}

/** Health a fall of `blocks` takes (docs « Joueur »: 6 per block beyond 3.5). */
export function fallDamage(blocks: number, b: BalanceDef): number {
  return Math.max(0, blocks - b.fall.safeBlocks) * b.fall.damagePerBlock;
}

/** −1 Cold, −2 Freezing, 1 Hot, 2 Overheating, 0 none. */
export function thermalStatus(temperature: number, b: BalanceDef): number {
  const t = b.temperature;
  if (temperature <= -t.severeAt) return -2;
  if (temperature <= -t.mildAt) return -1;
  if (temperature >= t.severeAt) return 2;
  if (temperature >= t.mildAt) return 1;
  return 0;
}

/** Largest stamina: lowered while starving. */
export function staminaCap(s: Readonly<SurvivalState>, b: BalanceDef, max: number): number {
  return s.hunger < b.hunger.lowAt ? Math.min(max, b.hunger.lowStaminaMax) : max;
}

/** Stamina regeneration factor: slower while parched. */
export function staminaRegen(s: Readonly<SurvivalState>, b: BalanceDef): number {
  return s.thirst < b.thirst.lowAt ? b.thirst.lowStaminaRegen : 1;
}

/** Adds a timed effect, or extends it to `ticks`. */
export function addEffect(s: SurvivalState, key: EffectKey, ticks: number): void {
  for (const effect of s.effects) {
    if (effect.key !== key) continue;
    effect.ticks = Math.max(effect.ticks, ticks);
    return;
  }
  s.effects.push({ key, ticks });
}

/** What a player does and touches this tick, besides the sampled environment. */
export interface Exposure extends Contact {
  sprinting: boolean;
  /** The head is under a liquid. */
  underwater: boolean;
}

/** Moves `value` towards `target`: faster on the way back to 0, never past 0 on that way. */
function drift(value: number, target: number, b: BalanceDef, minutes: number): number {
  if (value === target) return value;
  const t = b.temperature;
  const up = target > value;
  const back = up ? value < 0 : value > 0;
  const step = (back ? t.backPerMin : t.awayPerMin) * minutes;
  const next = up ? Math.min(target, value + step) : Math.max(target, value - step);
  return back && (up ? next > 0 : next < 0) ? 0 : next;
}

/** One tick of the gauges, their damage, regeneration and timed effects. */
export function stepGauges(s: SurvivalState, b: BalanceDef, e: Readonly<Exposure>): void {
  const minutes = TICK_SECONDS / 60;
  const status = thermalStatus(s.temperature, b);
  const hunger =
    b.hunger.perMin *
    (e.sprinting ? b.hunger.sprintFactor : 1) *
    (status < 0 ? b.hunger.coldFactor : 1) *
    minutes;
  const effort = s.staminaSpent / b.hunger.staminaPerPoint;
  s.hunger = clamp(s.hunger - hunger - effort, b.hunger.max);
  s.staminaSpent = 0;
  const thirst =
    b.thirst.perMin *
    (e.sprinting ? b.thirst.sprintFactor : 1) *
    (status > 0 ? b.thirst.hotFactor : 1) *
    minutes;
  s.thirst = clamp(s.thirst - thirst, b.thirst.max);
  s.temperature = drift(s.temperature, s.target, b, minutes);
  const sources = s.airToxicity + e.toxicity;
  const toxicity = sources > 0 ? sources : -b.toxicity.decayPerMin;
  s.toxicity = clamp(s.toxicity + toxicity * minutes, b.toxicity.max);
  s.breath = e.underwater
    ? Math.max(0, s.breath - TICK_SECONDS)
    : Math.min(b.breath.seconds, s.breath + b.breath.refillPerSec * TICK_SECONDS);
  s.calmTicks++;
  takeDamage(s, b, e, minutes);
  regenerate(s, b);
  stepEffects(s);
}

/** Damage over time of the empty or extreme gauges and of the blocks touched. */
function takeDamage(s: SurvivalState, b: BalanceDef, e: Readonly<Exposure>, minutes: number) {
  if (s.hunger === 0) hurt(s, b.hunger.emptyDamagePerMin * minutes, 'starvation');
  if (s.thirst === 0) hurt(s, b.thirst.emptyDamagePerMin * minutes, 'dehydration');
  const status = thermalStatus(s.temperature, b);
  if (status === -2 || status === 2)
    hurt(s, b.temperature.severeDamagePerMin * minutes, status < 0 ? 'cold' : 'heat');
  const t = b.toxicity;
  const poison =
    s.toxicity >= t.severeAt ? t.severePerMin : s.toxicity >= t.harmAt ? t.harmPerMin : 0;
  hurt(s, poison * minutes, 'toxicity');
  if (e.underwater && s.breath === 0) hurt(s, b.breath.drowningPerSec * TICK_SECONDS, 'drowning');
  hurt(s, e.damage * TICK_SECONDS, 'contact');
}

/** Health comes back while fed, not Nauseous, with no thermal status and calm for a while. */
function regenerate(s: SurvivalState, b: BalanceDef): void {
  const h = b.health;
  if (s.health <= 0 || s.health >= h.max || s.calmTicks < ticksOf(h.regenDelaySec)) return;
  if (s.hunger < h.regenFedAt || s.thirst < h.regenFedAt) return;
  if (s.toxicity >= b.toxicity.nauseousAt || thermalStatus(s.temperature, b) !== 0) return;
  const healed = Math.min(h.regenPerSec * TICK_SECONDS, h.max - s.health);
  s.health += healed;
  s.hunger = Math.max(0, s.hunger - healed * h.hungerPerPoint);
}

/** Counts the timed effects down and drops the finished ones (in place). */
function stepEffects(s: SurvivalState): void {
  const effects = s.effects;
  let kept = 0;
  for (let i = 0; i < effects.length; i++) {
    const effect = effects[i]!;
    if (--effect.ticks > 0) effects[kept++] = effect;
  }
  effects.length = kept;
}

/** Whether a block changed this tick (events from `first`) within `radius` blocks of a cell. */
function editedNear(
  out: readonly SimEvent[],
  first: number,
  x: number,
  y: number,
  z: number,
  radius: number,
): boolean {
  for (let i = first; i < out.length; i++) {
    const e = out[i]!;
    if (e.type !== 'blocksChanged') continue;
    const dx = Math.max(e.x0 - x, 0, x - e.x1);
    const dy = Math.max(e.y0 - y, 0, y - e.y1);
    const dz = Math.max(e.z0 - z, 0, z - e.z1);
    if (Math.max(dx, dy, dz) <= radius) return true;
  }
  return false;
}

const exposure: Exposure = { sprinting: false, underwater: false, toxicity: 0, damage: 0 };

/**
 * Tick step 11 « Survie et environnement » for every living player in a loaded column. The
 * environment is sampled every `shelter.checkSec`, and again the tick after a block changed
 * nearby (this tick's `blocksChanged` events, from `first`), once its light is resolved. A worn
 * filter wears every second it filters a toxic air.
 */
export function stepSurvival(sim: Simulation, out: SimEvent[], first: number): void {
  const b = sim.registry.pack.balance;
  for (const player of sim.players.values()) {
    const s = player.survival;
    if (s.health <= 0 || !sim.isActive(player)) continue;
    const body = player.body;
    if (--s.sampleTicks <= 0)
      s.sampleTicks = sampleEnvironment(sim, player) ? ticksOf(b.shelter.checkSec) : 1;
    const x = Math.floor(body.x);
    const y = Math.floor(body.y);
    const z = Math.floor(body.z);
    if (editedNear(out, first, x, y, z, b.shelter.editRadius)) s.sampleTicks = 1;
    touch(sim.registry, sim.world, player, exposure);
    exposure.sprinting = player.sprinting;
    exposure.underwater = body.headInWater;
    stepGauges(s, b, exposure);
    if (sim.tick % TICKS_PER_SECOND === 0) wearFilters(sim.registry, player, out);
  }
}
