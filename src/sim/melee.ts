import type { WeaponDef } from '../content/schema.ts';
import { lookVector, type Vec3 } from '../core/angles.ts';
import { unawareOf } from './ai/senses.ts';
import { ticksOf } from './clock.ts';
import { hurtCreature } from './combat.ts';
import { type CreatureState, creatureDef, isGone } from './creatures.ts';
import type { SimEvent } from './events.ts';
import { spendUses } from './inventory.ts';
import { eyeHeight } from './physics.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { hasEffect } from './survival.ts';

/*
 * The player's side of combat (docs « Combat », « Priorité des actions »), at tick step 7: primary
 * on a creature within the held weapon's reach attacks it instead of mining. The blow lands on the
 * release: a light one, or a charged one (×1.8 damage, ×1.5 knockback) once primary was held for
 * 0.5 s. A stealthy blow (the creature off its guard and the player out of its view: `unawareOf`)
 * deals ×1.5, a Weakened player ×0.8; the creature's front armour, invulnerability and knockback
 * resistance apply in `hurtCreature`. The weapon's cooldown separates two attacks. Zero
 * allocation per tick.
 */

export const MELEE = {
  /** Primary held this long (0.5 s) makes a charged attack. */
  chargeTicks: 15,
  chargedDamage: 1.8,
  chargedKnockback: 1.5,
  stealthDamage: 1.5,
} as const;

/** The held item's weapon, else the bare hand. */
export function weaponOf(sim: Simulation, player: Readonly<PlayerState>): WeaponDef {
  const stack = player.inventory[player.input.slot];
  const weapon = stack ? sim.registry.item(stack.item)?.weapon : undefined;
  return weapon ?? sim.registry.pack.balance.combat.hand;
}

/** Damage of a blow before the creature's own armour; `weakness` is the Weakened factor (or 1). */
export function meleeDamage(
  weapon: WeaponDef,
  charged: boolean,
  stealth: boolean,
  weakness: number,
): number {
  const charge = charged ? MELEE.chargedDamage : 1;
  return weapon.damage * charge * (stealth ? MELEE.stealthDamage : 1) * weakness;
}

/** Knockback factor of a blow (1 = a normal hit). */
export function meleeKnockback(weapon: WeaponDef, charged: boolean): number {
  return weapon.knockback * (charged ? MELEE.chargedKnockback : 1);
}

/**
 * One tick of primary against creatures. A press (or a hold) on a creature in reach starts an
 * attack, counted in `player.charge`; the release strikes the creature aimed at then, if the
 * cooldown is over. `blockDistance` is how far the aimed block is (a creature behind it is out of
 * reach). Returns whether primary is busy with an attack this tick (no mining then).
 */
export function stepMelee(
  sim: Simulation,
  player: PlayerState,
  blockDistance: number,
  out: SimEvent[],
): boolean {
  const weapon = weaponOf(sim, player);
  const target = aimedCreature(sim, player, Math.min(weapon.reach, blockDistance));
  if (player.input.primary) {
    if (player.charge < 0 && !target) return false;
    player.charge++;
    return true;
  }
  if (player.charge < 0) return false;
  const charged = player.charge >= MELEE.chargeTicks;
  player.charge = -1;
  if (target && player.attackCooldown === 0) attack(sim, player, target, weapon, charged, out);
  return true;
}

/** A blow at a creature: damage, knockback, the weapon's wear and the hit sound. */
function attack(
  sim: Simulation,
  player: PlayerState,
  c: CreatureState,
  weapon: WeaponDef,
  charged: boolean,
  out: SimEvent[],
): void {
  const def = creatureDef(sim, c);
  const respawn = sim.registry.pack.balance.respawn;
  const weakness = hasEffect(player.survival, 'weakened') ? respawn.weakenedDamage : 1;
  const damage = meleeDamage(weapon, charged, unawareOf(c, def, player), weakness);
  player.attackCooldown = ticksOf(weapon.cooldown);
  const b = player.body;
  const knockback = meleeKnockback(weapon, charged);
  if (hurtCreature(sim, c, damage, b.x, b.z, knockback, player.id, out) <= 0) return;
  wearWeapon(sim, player, out);
  const sfx = sim.registry.pack.sounds?.combat.hit;
  if (sfx)
    out.push({ type: 'sound', sfx, x: c.body.x, y: c.body.y + def.hitbox[1] / 2, z: c.body.z });
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

/** Scratch: nearby entity ids, the view direction and the slab test's interval. */
const near: number[] = [];
const dir: Vec3 = { x: 0, y: 0, z: -1 };
let tNear = 0;
let tFar = 0;

/**
 * The creature whose hitbox the player's view ray (from the simulation's eye) enters first within
 * `reach` blocks, else undefined. Dying and burrowing creatures are not targets.
 */
export function aimedCreature(
  sim: Simulation,
  player: Readonly<PlayerState>,
  reach: number,
): CreatureState | undefined {
  const b = player.body;
  const ey = b.y + eyeHeight(b);
  lookVector(player.yaw, player.pitch, dir);
  sim.spatial.query(b.x, b.z, reach + HITBOX_MARGIN, near);
  let best: CreatureState | undefined;
  let bestT = reach;
  for (let i = 0; i < near.length; i++) {
    const c = sim.entities.get(near[i]!);
    if (c?.kind !== 'creature' || isGone(c)) continue;
    const hitbox = creatureDef(sim, c).hitbox;
    const half = hitbox[0] / 2;
    const p = c.body;
    tNear = 0;
    tFar = bestT;
    if (
      slab(b.x, dir.x, p.x - half, p.x + half) &&
      slab(ey, dir.y, p.y, p.y + hitbox[1]) &&
      slab(b.z, dir.z, p.z - half, p.z + half)
    ) {
      best = c;
      bestT = tNear;
    }
  }
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
