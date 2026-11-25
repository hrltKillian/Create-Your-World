import type { RawTables, Registry } from '../content/registry.ts';
import type { WeaponDef } from '../content/schema.ts';
import { lookVector, type Vec3 } from '../core/angles.ts';
import { centreY } from '../core/creatures.ts';
import { createRayHit, RAY_SOLID, raycast } from '../world/raycast.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import { unawareOf } from './ai/senses.ts';
import { ticksOf } from './clock.ts';
import { hurtCreature } from './combat.ts';
import { type CreatureState, creatureDef, isGone } from './creatures.ts';
import type { SimEvent } from './events.ts';
import { type ItemStack, spendUses } from './inventory.ts';
import { eyeHeight } from './physics.ts';
import type { PlayerState } from './player.ts';
import { strengthFactor } from './progression.ts';
import type { Entity, Simulation } from './Simulation.ts';

/*
 * The player's side of combat (docs « Combat », plan v3 « M19 »), at tick step 7: the press of
 * primary on a creature within the held weapon's reach strikes it instead of mining (creatures are
 * tested first, docs « Ciblage »: only a solid block stops a blow, so a creature in or behind tall
 * grass or a torch is still in reach); a press on nothing (no creature, no block) swings in the
 * air. Every swing empties the attack gauge, which fills again over the weapon's `cooldown`
 * (`player.attackCooldown`: the ticks left). A blow with the gauge full is a strong one (×1.8
 * damage, ×1.5 knockback); any other, however full the gauge, a plain one. A stealthy blow (the
 * creature off its guard and the player out of its view: `unawareOf`) deals ×1.5; the creature's front armour, invulnerability and knockback resistance apply in
 * `hurtCreature`. A press that struck or swung holds primary until it is released: no mining.
 * Zero allocation per tick.
 */

export const MELEE = {
  strongDamage: 1.8,
  strongKnockback: 1.5,
  stealthDamage: 1.5,
} as const;

/** The weapon of a held stack, else the bare hand. */
export function weaponOf(registry: Registry, stack: ItemStack | null | undefined): WeaponDef {
  const weapon = stack ? registry.item(stack.item)?.weapon : undefined;
  return weapon ?? registry.pack.balance.combat.hand;
}

/** The weapon a player holds (the selected hotbar slot), else the bare hand. */
export function heldWeapon(sim: Simulation, player: Readonly<PlayerState>): WeaponDef {
  return weaponOf(sim.registry, player.inventory[player.input.slot]);
}

/** Damage of a blow before the creature's own armour (`strength`: the skill's factor). */
export function meleeDamage(
  weapon: WeaponDef,
  strong: boolean,
  stealth: boolean,
  strength: number,
): number {
  const power = strong ? MELEE.strongDamage : 1;
  return weapon.damage * power * (stealth ? MELEE.stealthDamage : 1) * strength;
}

/** Knockback factor of a blow (1 = a normal hit). */
export function meleeKnockback(weapon: WeaponDef, strong: boolean): number {
  return weapon.knockback * (strong ? MELEE.strongKnockback : 1);
}

/** How full a player's attack gauge is (0–1) for the weapon held now. */
export function attackGauge(registry: Registry, player: Readonly<PlayerState>): number {
  const full = ticksOf(weaponOf(registry, player.inventory[player.input.slot]).cooldown);
  return full <= 0 ? 1 : Math.max(0, 1 - player.attackCooldown / full);
}

/**
 * One tick of primary against creatures; `target` is the creature aimed at in reach (meleeTarget),
 * `onBlock` whether a block is aimed at. The press strikes the target (strong when the gauge is
 * full), or swings in the air when nothing is aimed at; either empties the gauge. Returns whether
 * primary is busy with that swing (held since: no mining).
 */
export function stepMelee(
  sim: Simulation,
  player: PlayerState,
  target: CreatureState | undefined,
  onBlock: boolean,
  out: SimEvent[],
): boolean {
  const primary = player.input.primary;
  const pressed = primary && !player.primaryHeld;
  player.primaryHeld = primary;
  if (!primary) {
    player.swinging = false;
    return false;
  }
  if (pressed && (target || !onBlock)) {
    player.swinging = true;
    const weapon = heldWeapon(sim, player);
    const strong = player.attackCooldown === 0;
    player.attackCooldown = ticksOf(weapon.cooldown);
    out.push({ type: 'playerSwung', playerId: player.playerId, strong: strong && !!target });
    if (target) attack(sim, player, target, weapon, strong, out);
  }
  return player.swinging;
}

/** A blow at a creature: damage, knockback, the weapon's wear and the hit sound. */
function attack(
  sim: Simulation,
  player: PlayerState,
  c: CreatureState,
  weapon: WeaponDef,
  strong: boolean,
  out: SimEvent[],
): void {
  const def = creatureDef(sim, c);
  const strength = strengthFactor(player, sim.registry.pack.balance);
  const damage = meleeDamage(weapon, strong, unawareOf(c, def, player), strength);
  const b = player.body;
  const knockback = meleeKnockback(weapon, strong);
  if (hurtCreature(sim, c, damage, b.x, b.z, knockback, player.id, out) <= 0) return;
  wearWeapon(sim, player, out);
  const sfx = sim.registry.pack.sounds?.combat.hit;
  if (sfx)
    out.push({ type: 'sound', sfx, x: c.body.x, y: centreY(c.body.y, def.hitbox[1]), z: c.body.z });
}

/** A held weapon that wears (a tool) loses one use per blow landed. */
function wearWeapon(sim: Simulation, player: PlayerState, out: SimEvent[]): void {
  const registry = sim.registry;
  const slot = player.input.slot;
  const id = registry.itemId(player.inventory[slot]?.item ?? '');
  if (id < 0 || !registry.items[id]!.weapon || registry.itemTables.durability[id]! <= 0) return;
  spendUses(registry, player.inventory, slot, 1);
  out.push({ type: 'inventoryChanged', playerId: player.playerId });
}

/** Creatures up to this much farther than the reach may still show a hitbox edge within it. */
const HITBOX_MARGIN = 1;

/** Scratch: nearby entity ids, the view direction, the reach ray and the slab test's interval. */
const near: number[] = [];
const dir: Vec3 = { x: 0, y: 0, z: -1 };
const wall = createRayHit();
let tNear = 0;
let tFar = 0;

/**
 * How far a blow reaches along a ray (from the eye, normalised direction `d`): `reach`, cut short
 * by the first solid block. Plants, torches and liquids do not stop a blow.
 */
export function blowReach(
  world: VoxelWorld,
  tables: RawTables,
  ox: number,
  oy: number,
  oz: number,
  d: Readonly<Vec3>,
  reach: number,
): number {
  raycast(world, tables, ox, oy, oz, d.x, d.y, d.z, reach, wall, RAY_SOLID);
  return wall.hit ? wall.distance : reach;
}

/**
 * How far along a ray (from (ox, oy, oz), normalised direction `d`) it enters the hitbox of an
 * entity that is a creature to attack, when that is within `limit`; else −1. Dying and burrowing
 * creatures are not targets. The simulation's aim and the client's alike.
 */
export function creatureOnRay(
  registry: Registry,
  e: Readonly<Entity> | undefined,
  ox: number,
  oy: number,
  oz: number,
  d: Readonly<Vec3>,
  limit: number,
): number {
  if (e?.kind !== 'creature' || isGone(e)) return -1;
  const hitbox = registry.creature(e.creature)!.hitbox;
  const half = hitbox[0] / 2;
  const p = e.body;
  tNear = 0;
  tFar = limit;
  const enters =
    slab(ox, d.x, p.x - half, p.x + half) &&
    slab(oy, d.y, p.y, p.y + hitbox[1]) &&
    slab(oz, d.z, p.z - half, p.z + half);
  return enters ? tNear : -1;
}

/**
 * The creature a player's blow would hit now: the first whose hitbox the view ray from the
 * simulation's eye enters within the held weapon's reach and before any solid block (blowReach),
 * else undefined. `at.distance` gets how far along the ray it is entered.
 */
export function meleeTarget(
  sim: Simulation,
  player: Readonly<PlayerState>,
  at: { distance: number },
): CreatureState | undefined {
  const b = player.body;
  const ey = b.y + eyeHeight(b);
  lookVector(player.yaw, player.pitch, dir);
  const reach = heldWeapon(sim, player).reach;
  return creatureAlong(
    sim,
    player,
    blowReach(sim.world, sim.registry.tables, b.x, ey, b.z, dir, reach),
    at,
  );
}

/**
 * The nearest living creature whose hitbox the player's view ray enters within `limit` blocks
 * (blows: their reach to the first solid block; a scanner: its range to the first opaque one);
 * its distance goes into `at`.
 */
export function creatureAlong(
  sim: Simulation,
  player: Readonly<PlayerState>,
  limit: number,
  at: { distance: number },
): CreatureState | undefined {
  const b = player.body;
  const ey = b.y + eyeHeight(b);
  lookVector(player.yaw, player.pitch, dir);
  let bestT = limit;
  sim.spatial.query(b.x, b.z, bestT + HITBOX_MARGIN, near);
  let best: CreatureState | undefined;
  for (let i = 0; i < near.length; i++) {
    const c = sim.entities.get(near[i]!);
    const t = creatureOnRay(sim.registry, c, b.x, ey, b.z, dir, bestT);
    if (t < 0) continue;
    best = c as CreatureState;
    bestT = t;
  }
  at.distance = bestT;
  return best;
}

/**
 * One axis of a ray–box test (slabs): narrows [tNear, tFar] to where the ray `o + t·d` is between
 * `lo` and `hi` on that axis; false once the interval is empty.
 */
function slab(o: number, d: number, lo: number, hi: number): boolean {
  if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
  const t0 = (lo - o) / d;
  const t1 = (hi - o) / d;
  tNear = Math.max(tNear, Math.min(t0, t1));
  tFar = Math.min(tFar, Math.max(t0, t1));
  return tNear <= tFar;
}
