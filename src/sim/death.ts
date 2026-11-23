import { FLAG_REPLACEABLE, type Registry } from '../content/registry.ts';
import { cellKey, WORLD_HEIGHT } from '../world/coords.ts';
import { removeBlockEntity } from './blockEntities.ts';
import { closeBlockEntity } from './blockEntityCommands.ts';
import { ticksOf } from './clock.ts';
import { reject } from './commandRules.ts';
import { editBlock } from './edits.ts';
import { wearSlotOf } from './equipment.ts';
import type { SimEvent } from './events.ts';
import { stopMining } from './interaction.ts';
import { addItem, addToRange, type Inventory, type ItemStack } from './inventory.ts';
import { spawnDrop } from './itemDrops.ts';
import { type BlockCell, type PlayerState, STAMINA } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { addEffect, createSurvival } from './survival.ts';

/*
 * Death and respawn (docs « Mort », tick step 14). A player whose health ran out leaves all they
 * carried (inventory, worn items, the ingredients the craft queue reserved) in a permanent
 * Abandoned Pack where they died, recorded in their `graves` for the compass, and lies still until
 * the Respawn command: back at the bedroll slept on last, else at the spawn, with 60 health, 50
 * hunger and 50 thirst, Weakened for 2 minutes and untargeted for 5 seconds. Secondary on a pack
 * takes back what fits, the worn items back on (the pack keeps them apart); an emptied pack goes,
 * and its marker with it. Nothing is ever lost: a pack that cannot be left (no free cell above, no
 * grave block in the pack) spills on the ground.
 */

/** Tick step 14: handles each new death of a player in a loaded column. */
export function stepDeaths(sim: Simulation, out: SimEvent[]): void {
  for (const player of sim.players.values()) {
    const s = player.survival;
    if (s.health > 0 || s.dead || !sim.isActive(player)) continue;
    s.dead = true;
    die(sim, player, out);
  }
}

function die(sim: Simulation, player: PlayerState, out: SimEvent[]): void {
  stopMining(player, out);
  if (player.opened) closeBlockEntity(player, out);
  player.sleeping = null;
  const stacks = carried(sim.registry, player);
  const worn = player.equipment.slice();
  player.equipment.fill(null);
  const any = stacks.length > 0 || worn.some((stack) => stack !== null);
  const b = player.body;
  const cell = any ? leavePack(sim, b.x, b.y, b.z, stacks, worn, out) : null;
  if (cell) player.graves.push(cell);
  else
    for (const stack of [...stacks, ...worn]) if (stack) spawnDrop(sim, stack, b.x, b.y + 0.5, b.z);
  if (any) out.push({ type: 'inventoryChanged', playerId: player.playerId });
  const { x, y, z } = cell ?? { x: Math.floor(b.x), y: Math.floor(b.y), z: Math.floor(b.z) };
  const cause = player.survival.cause;
  out.push({ type: 'died', playerId: player.playerId, cause, x, y, z, pack: cell !== null });
}

/**
 * Takes everything a player carries but the worn items: the inventory, then the craft queue's
 * reserved ingredients (merged onto the stacks they match). The stacks keep their wear.
 */
function carried(registry: Registry, player: PlayerState): ItemStack[] {
  const stacks: ItemStack[] = [];
  const slots = player.inventory;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i]) stacks.push(slots[i]!);
    slots[i] = null;
  }
  for (const entry of player.craft) {
    for (const stack of entry.reserved) {
      if (!stack) continue;
      const left = addToRange(stacks, registry, 0, stacks.length, stack);
      if (left > 0) stacks.push({ ...stack, count: left });
    }
  }
  player.craft = [];
  return stacks;
}

/**
 * Leaves an Abandoned Pack holding `slots` and the `worn` items in the first free cell (air or
 * replaceable, with no block entity) from the feet up; returns its cell, or null without one.
 */
function leavePack(
  sim: Simulation,
  x: number,
  y: number,
  z: number,
  slots: Inventory,
  worn: Inventory,
  out: SimEvent[],
): BlockCell | null {
  const { registry, world } = sim;
  if (registry.grave < 0) return null;
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  for (let cy = Math.max(0, Math.floor(y)); cy < WORLD_HEIGHT; cy++) {
    const state = world.getBlock(cx, cy, cz);
    const free = state === registry.air || (registry.tables.flags[state]! & FLAG_REPLACEABLE) !== 0;
    if (!free || sim.blockEntities.has(cellKey(cx, cy, cz))) continue;
    editBlock(world, sim.light, cx, cy, cz, registry.grave, out);
    sim.blockEntities.set(cellKey(cx, cy, cz), { kind: 'grave', x: cx, y: cy, z: cz, slots, worn });
    return { x: cx, y: cy, z: cz };
  }
  return null;
}

/** The Respawn command of a dead player (refused while alive). */
export function respawn(sim: Simulation, player: PlayerState, out: SimEvent[]): void {
  const s = player.survival;
  if (!s.dead) {
    reject(out, player.playerId, 'player.respawn', 'alive');
    return;
  }
  const r = sim.registry.pack.balance.respawn;
  const bed = player.respawn;
  const x = bed ? bed.x + 0.5 : sim.spawn.x;
  const y = bed ? bed.y : sim.spawn.y;
  const z = bed ? bed.z + 0.5 : sim.spawn.z;
  // Far away, the player waits frozen (and the client shows its loading screen) until the
  // columns there are lit.
  sim.teleport(player, x, y, z);
  // Fresh gauges; a debug immunity stays.
  Object.assign(s, createSurvival(sim.registry.pack.balance), { god: s.god });
  s.health = r.health;
  s.hunger = r.hunger;
  s.thirst = r.thirst;
  addEffect(s, 'weakened', ticksOf(r.weakenedSec));
  addEffect(s, 'untargeted', ticksOf(r.untargetedSec));
  player.stamina = STAMINA.max;
  player.exhausted = false;
  out.push({ type: 'respawned', playerId: player.playerId, x, y, z });
}

/**
 * Secondary on an Abandoned Pack: the items worn at the death go back on where those slots are
 * free, everything else into the inventory as far as it fits. Returns the refusal, if any.
 */
export function recoverPack(
  sim: Simulation,
  player: PlayerState,
  x: number,
  y: number,
  z: number,
  out: SimEvent[],
): string | null {
  const pack = sim.blockEntities.get(cellKey(x, y, z));
  if (pack?.kind !== 'grave') return 'nothing to open';
  const registry = sim.registry;
  const worn = pack.worn;
  let moved = false;
  for (let i = 0; i < worn.length; i++) {
    const stack = worn[i];
    if (!stack || player.equipment[i] || wearSlotOf(registry, stack.item) !== i) continue;
    player.equipment[i] = stack;
    worn[i] = null;
    moved = true;
  }
  const bag = takeInto(registry, player.inventory, worn);
  const rest = takeInto(registry, player.inventory, pack.slots);
  if (!moved && !bag.moved && !rest.moved) return 'inventory full';
  out.push({ type: 'inventoryChanged', playerId: player.playerId });
  const state = sim.world.getBlock(x, y, z);
  const sfx = registry.blockSfx(state, 'break');
  if (sfx) out.push({ type: 'sound', sfx, x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  if (bag.left || rest.left) return null;
  removeBlockEntity(sim, x, y, z);
  editBlock(sim.world, sim.light, x, y, z, registry.air, out);
  forgetGrave(sim, x, y, z);
  return null;
}

/** Moves the stacks of `slots` into an inventory as far as they fit (what is left stays). */
function takeInto(
  registry: Registry,
  inventory: Inventory,
  slots: Inventory,
): { moved: boolean; left: boolean } {
  let moved = false;
  let left = false;
  for (let i = 0; i < slots.length; i++) {
    const stack = slots[i];
    if (!stack) continue;
    const rest = addItem(inventory, registry, stack);
    moved ||= rest < stack.count;
    if (rest === 0) slots[i] = null;
    else {
      stack.count = rest;
      left = true;
    }
  }
  return { moved, left };
}

/** An Abandoned Pack gone (taken back, broken): it no longer marks any player's compass. */
export function forgetGrave(sim: Simulation, x: number, y: number, z: number): void {
  for (const player of sim.players.values())
    player.graves = player.graves.filter((cell) => cell.x !== x || cell.y !== y || cell.z !== z);
}
