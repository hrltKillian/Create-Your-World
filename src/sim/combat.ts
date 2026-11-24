import type { CreatureDef } from '../content/schema.ts';
import { centreY, DYING_TICKS } from '../core/creatures.ts';
import { hash32 } from '../core/hash.ts';
import { BRAIN, setMode, voice } from './ai/behaviours.ts';
import { alarm } from './ai/brains.ts';
import { lineOfSight, targetOf } from './ai/senses.ts';
import { ticksOf } from './clock.ts';
import { type CreatureState, creatureDef, eyeY, isGone, reachGap } from './creatures.ts';
import { type Gear, wornGear } from './environment.ts';
import type { SimEvent } from './events.ts';
import { spawnDrop } from './itemDrops.ts';
import { rollLoot } from './loot.ts';
import { eyeHeight } from './physics.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { adjustGauges, hurt } from './survival.ts';
import { dayOf } from './time.ts';

/*
 * Tick step 8 « Combat » (docs « Combat »), the creatures' side (the player's attacks, at tick
 * step 7, are in melee.ts and land through `hurtCreature`): telegraphed blows land when their
 * wind-up ends, if the target is still within reach + 0.3 and in sight (else it dodged); a
 * charger's wind-up launches its charge, which hits on contact. Worn armour takes
 * `damage × 20/(20 + A)`; a blow knocks back (6 m/s across, 3 up, × the attack's factor ×
 * (1 − resistance)) and grants 15 ticks of invulnerability to players, 8 to creatures. A Shellback
 * takes 60 % less from the front; a Prowler hits harder every night. Zero allocation per tick.
 */

export const COMBAT = {
  playerInvulnerableTicks: 15,
  creatureInvulnerableTicks: 8,
  /** Knockback speeds of a normal hit (m/s). */
  knockback: 6,
  knockbackUp: 3,
  /** A telegraphed blow still lands within its reach + this (blocks). */
  dodgeMargin: 0.3,
  /** Armour A takes damage × armorBase / (armorBase + A). */
  armorBase: 20,
  /** A blow from within this angle of a creature's facing hits its front. */
  frontHalfAngleDeg: 60,
  /** Ticks a player stays loud after a blow given or taken (hearing). */
  fightTicks: 30,
} as const;

const FRONT_COS = Math.cos((COMBAT.frontHalfAngleDeg * Math.PI) / 180);

/** Share of the damage that worn armour lets through. */
export function armorFactor(armor: number): number {
  return COMBAT.armorBase / (COMBAT.armorBase + armor);
}

/** A creature's damage factor on a day: × (1 + perDay × min(day, maxDays)) when it escalates. */
export function escalation(def: CreatureDef, day: number): number {
  const e = def.traits?.escalation;
  return e ? 1 + e.perDay * Math.min(day, e.maxDays) : 1;
}

/** Share of a blow from (x, z) that reaches a creature: its front armour stops some of it. */
export function frontFactor(
  c: Readonly<CreatureState>,
  def: CreatureDef,
  x: number,
  z: number,
): number {
  const armor = def.traits?.frontArmor;
  if (!armor) return 1;
  const dx = x - c.body.x;
  const dz = z - c.body.z;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length < 1e-6) return 1;
  const facing = (-Math.sin(c.yaw) * dx - Math.cos(c.yaw) * dz) / length;
  return facing >= FRONT_COS ? 1 - armor : 1;
}

/** Knocks a body away from (x, z): `factor` × 6 m/s across and × 3 m/s up. */
function knock(
  body: { x: number; z: number; vx: number; vy: number; vz: number },
  x: number,
  z: number,
  factor: number,
): void {
  if (factor <= 0) return;
  let dx = body.x - x;
  let dz = body.z - z;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length < 1e-6) return;
  dx /= length;
  dz /= length;
  body.vx = dx * COMBAT.knockback * factor;
  body.vz = dz * COMBAT.knockback * factor;
  body.vy = Math.max(body.vy, COMBAT.knockbackUp * factor);
}

export function stepCombat(sim: Simulation, out: SimEvent[]): void {
  for (const player of sim.players.values()) {
    if (player.invulnerable > 0) player.invulnerable--;
    if (player.fightTicks > 0) player.fightTicks--;
    if (player.attackCooldown > 0) player.attackCooldown--;
  }
  for (const c of sim.entities.values()) {
    if (c.kind !== 'creature') continue;
    if (c.mode === 'windup' && c.modeTicks === 0) endWindup(sim, c, creatureDef(sim, c), out);
    else if (c.mode === 'charge') charging(sim, c, creatureDef(sim, c), out);
  }
}

/** The telegraph is over: the charger charges at its target, the others strike. */
function endWindup(sim: Simulation, c: CreatureState, def: CreatureDef, out: SimEvent[]): void {
  const attack = def.attack;
  const target = targetOf(sim, c);
  if (!attack) {
    setMode(c, 'idle');
    return;
  }
  c.cooldown = ticksOf(attack.cooldown);
  if (def.brain === 'charger') {
    if (target) c.yaw = Math.atan2(c.body.x - target.body.x, c.body.z - target.body.z);
    setMode(c, 'charge', BRAIN.chargeTicks);
    return;
  }
  if (target) strike(sim, c, def, target, out);
  setMode(c, 'recover', BRAIN.recoverTicks);
}

/** A charge hits its target on contact, then the charger recovers. */
function charging(sim: Simulation, c: CreatureState, def: CreatureDef, out: SimEvent[]): void {
  const target = targetOf(sim, c);
  if (!target || reachGap(c, def, target) > (def.attack?.reach ?? 0)) return;
  strike(sim, c, def, target, out);
  setMode(c, 'recover', BRAIN.recoverTicks);
}

const gear: Gear = { armor: 0, warmth: 0, cooling: 0, airFilter: 1, waterproof: false };

/**
 * A creature's blow at a player lands unless the player dodged (out of reach + 0.3, or out of
 * sight) or was hit moments ago. Returns whether it landed.
 */
export function strike(
  sim: Simulation,
  c: Readonly<CreatureState>,
  def: CreatureDef,
  player: PlayerState,
  out: SimEvent[],
): boolean {
  const attack = def.attack;
  if (!attack || player.invulnerable > 0 || player.survival.health <= 0) return false;
  if (reachGap(c, def, player) > attack.reach + COMBAT.dodgeMargin) return false;
  const b = player.body;
  const tables = sim.registry.tables;
  const from = eyeY(c, def);
  if (!lineOfSight(sim.world, tables, c.body.x, from, c.body.z, b.x, b.y + eyeHeight(b), b.z))
    return false;
  const armor = wornGear(sim.registry, player.equipment, gear).armor;
  const damage = attack.damage * escalation(def, dayOf(sim.time.ticks)) * armorFactor(armor);
  hurt(player.survival, damage, 'creature');
  if (attack.toxicity)
    adjustGauges(player.survival, sim.registry.pack.balance, 0, 0, 0, attack.toxicity);
  player.invulnerable = COMBAT.playerInvulnerableTicks;
  player.fightTicks = COMBAT.fightTicks;
  knock(b, c.body.x, c.body.z, attack.knockback);
  const sfx = sim.registry.pack.sounds?.combat.hurt;
  if (sfx) out.push({ type: 'sound', sfx, x: b.x, y: b.y + eyeHeight(b), z: b.z });
  out.push({
    type: 'playerHurt',
    playerId: player.playerId,
    amount: damage,
    source: c.id,
    x: c.body.x,
    z: c.body.z,
  });
  return true;
}

/**
 * Hurts a creature by `amount` from a blow struck at (x, z) by entity `attacker` (a player's
 * weapon: the combat rules of the player's side); the knockback factor is the attack's (1 for a
 * normal hit). Its front armour, its invulnerability after a hit and its knockback resistance
 * apply; it reacts (brains `alarm`), or dies and drops its loot. Returns the damage dealt.
 */
export function hurtCreature(
  sim: Simulation,
  c: CreatureState,
  amount: number,
  x: number,
  z: number,
  knockback: number,
  attacker: number,
  out: SimEvent[],
): number {
  if (amount <= 0 || c.invulnerable > 0 || isGone(c)) return 0;
  const def = creatureDef(sim, c);
  const dealt = Math.min(c.health, amount * frontFactor(c, def, x, z));
  c.health -= dealt;
  c.invulnerable = COMBAT.creatureInvulnerableTicks;
  knock(c.body, x, z, knockback * (1 - (def.traits?.knockbackResist ?? 0)));
  const fighter = sim.entities.get(attacker);
  if (fighter?.kind === 'player') fighter.fightTicks = COMBAT.fightTicks;
  const b = c.body;
  out.push({ type: 'creatureHurt', id: c.id, amount: dealt, attacker, x: b.x, y: b.y, z: b.z });
  if (c.health > 0) {
    voice(c, def, 'hurt', out);
    alarm(sim, c, def, attacker, x, z, out);
  } else {
    die(sim, c, def, attacker, out);
  }
  return dealt;
}

/** The creature falls over (removed after DYING_TICKS) and drops its loot. */
function die(
  sim: Simulation,
  c: CreatureState,
  def: CreatureDef,
  attacker: number,
  out: SimEvent[],
): void {
  setMode(c, 'dying', DYING_TICKS);
  c.target = -1;
  c.pathLength = 0;
  const b = c.body;
  voice(c, def, 'death', out);
  out.push({ type: 'creatureDied', id: c.id, creature: def.key, attacker, x: b.x, y: b.y, z: b.z });
  const table = sim.registry.loot(def.loot);
  if (!table) return;
  const y = centreY(b.y, def.hitbox[1]);
  rollLoot(table, hash32(sim.ctx.seedHash, c.id, sim.tick), (item, count) =>
    spawnDrop(sim, { item, count }, b.x, y, b.z),
  );
}
