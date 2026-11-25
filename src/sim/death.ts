import {
  COLLISION_LIQUID,
  COLLISION_NONE,
  FLAG_REPLACEABLE,
  FLAG_SOLID,
  type Registry,
} from '../content/registry.ts';
import { cellKey, WORLD_HEIGHT } from '../world/coords.ts';
import { spiral } from '../world/gen/find.ts';
import { removeBlockEntity } from './blockEntities.ts';
import { noteChanged } from './blockUpdates.ts';
import { reject } from './commandRules.ts';
import { editBlock } from './edits.ts';
import { wearSlotOf } from './equipment.ts';
import type { SimEvent } from './events.ts';
import { stopMining } from './interaction.ts';
import { addItem, type Inventory, type ItemStack, pileOnto } from './inventory.ts';
import { spawnDrop } from './itemDrops.ts';
import { type BlockCell, type PlayerState, STAMINA } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { closeScreen, stowCursor } from './screens.ts';
import { collisionReader, surfaceAt } from './surface.ts';
import { createSurvival } from './survival.ts';

/*
 * Death and respawn (docs « Mort », tick step 14). A player whose health ran out leaves all they
 * carried (inventory, worn items, the ingredients the craft queue reserved) in a permanent
 * Abandoned Pack where they died, recorded in their `graves` for the compass, and lies still until
 * the Respawn command: back at the bedroll slept on last, else on the ground at the spawn (beside
 * it when the ground there was dug below the spawn's height: never over a shaft), with 60 health, 50
 * hunger and 50 thirst. Secondary on a pack
 * takes back what fits, the worn items back on (the pack keeps them apart); an emptied pack goes,
 * and its marker with it. Nothing is ever lost: a pack that cannot be left (no free cell near, no
 * grave block in the pack) spills on the ground.
 */

/** How far a pack looks for a free cell (steps from the feet) and a respawn for ground (rings). */
const PACK_REACH = 2;
const SPAWN_RINGS = 4;

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
  // A charge held at death is dropped (no blow at the respawn, no arm drawn back meanwhile).
  player.swinging = false;
  player.sleeping = null;
  // The cursor stack goes with the rest into the pack (not back to the inventory on closing).
  const stacks = carried(sim.registry, player);
  closeScreen(sim, player, out);
  const worn = player.equipment.slice();
  player.equipment.fill(null);
  const any = stacks.length > 0 || worn.some((stack) => stack !== null);
  const b = player.body;
  const cell = any ? leavePack(sim, b.x, b.y, b.z, stacks, worn, out) : null;
  player.survival.packLeft = cell !== null;
  if (cell) player.graves.push(cell);
  else
    for (const stack of [...stacks, ...worn]) if (stack) spawnDrop(sim, stack, b.x, b.y + 0.5, b.z);
  if (any) out.push({ type: 'inventoryChanged', playerId: player.playerId });
  const { x, y, z } = cell ?? { x: Math.floor(b.x), y: Math.floor(b.y), z: Math.floor(b.z) };
  const cause = player.survival.cause;
  out.push({ type: 'died', playerId: player.playerId, cause, x, y, z, pack: cell !== null });
}

/**
 * Takes everything a player carries but the worn items: the inventory, then the cursor stack of an
 * open screen and the craft queue's reserved ingredients (merged onto the stacks they match). The
 * stacks keep their wear.
 */
function carried(registry: Registry, player: PlayerState): ItemStack[] {
  const stacks: ItemStack[] = [];
  const slots = player.inventory;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i]) stacks.push(slots[i]!);
    slots[i] = null;
  }
  const loose: Inventory = [player.cursor];
  player.cursor = null;
  for (const entry of player.craft) loose.push(...entry.reserved);
  for (const stack of loose) if (stack) pileOnto(stacks, registry, stack);
  player.craft = [];
  return stacks;
}

/** The steps a pack takes from cell to cell, up first, down last. */
const PACK_STEPS: readonly (readonly [number, number, number])[] = [
  [0, 1, 0],
  [-1, 0, 0],
  [1, 0, 0],
  [0, 0, -1],
  [0, 0, 1],
  [0, -1, 0],
];

/**
 * Leaves an Abandoned Pack holding `slots` and the `worn` items in the free cell (air or
 * replaceable, with no block entity) nearest the feet: a breadth-first walk from the feet through
 * cells without collision, up first, at most PACK_REACH steps (a doorway or a torch at the feet
 * sends it beside them, never through rock); returns its cell, or null without one.
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
  const feet = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
  const seen = new Set([cellKey(feet.x, feet.y, feet.z)]);
  let ring: BlockCell[] = [feet];
  for (let d = 0; d <= PACK_REACH && ring.length > 0; d++) {
    for (const cell of ring)
      if (
        packFits(sim, cell.x, cell.y, cell.z) &&
        editBlock(world, sim.light, cell.x, cell.y, cell.z, registry.grave, out)
      ) {
        sim.blockEntities.set(cellKey(cell.x, cell.y, cell.z), {
          kind: 'grave',
          ...cell,
          slots,
          worn,
        });
        return cell;
      }
    const next: BlockCell[] = [];
    for (const cell of ring)
      for (const [dx, dy, dz] of PACK_STEPS) {
        const step = { x: cell.x + dx, y: cell.y + dy, z: cell.z + dz };
        const key = cellKey(step.x, step.y, step.z);
        if (step.y < 0 || step.y >= WORLD_HEIGHT || seen.has(key)) continue;
        seen.add(key);
        const state = world.getBlock(step.x, step.y, step.z);
        if (state !== world.outside && (registry.tables.flags[state]! & FLAG_SOLID) === 0)
          next.push(step);
      }
    ring = next;
  }
  return null;
}

/** Whether a pack may go in a cell: inside the world, air or replaceable, with no block entity. */
function packFits(sim: Simulation, x: number, y: number, z: number): boolean {
  if (y < 0 || y >= WORLD_HEIGHT) return false;
  const { registry } = sim;
  const state = sim.world.getBlock(x, y, z);
  const free = state === registry.air || (registry.tables.flags[state]! & FLAG_REPLACEABLE) !== 0;
  return free && !sim.blockEntities.has(cellKey(x, y, z));
}

/** Heights a respawn tries in a column, from the spawn's: the same, then up or down 1, then 2. */
const SPAWN_BAND = [0, 1, -1, 2, -2];

/**
 * Where a player with no bedroll comes back: at the spawn while they can stand there, else on the
 * first cell they can stand on within SPAWN_BAND of its height in the spawn's column, then in the
 * nearest columns (a fixed spiral): never over a shaft, nor on a roof or a canopy over it. Last, on
 * the floor of a pit dug all around, so no fall awaits.
 */
function spawnPoint(sim: Simulation): { x: number; y: number; z: number } {
  const { x, y, z } = sim.spawn;
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  const standable = standableIn(collisionReader(sim));
  let point: { x: number; y: number; z: number } | null = null;
  spiral(SPAWN_RINGS, (dx, dz) => {
    for (const dy of SPAWN_BAND)
      if (standable(bx + dx, y + dy, bz + dz)) {
        point = { x: x + dx, y: y + dy, z: z + dz };
        return true;
      }
    return false;
  });
  if (point) return point;
  for (let floor = y - 3; floor > 0; floor--)
    if (standable(bx, floor, bz)) return { x, y: floor, z };
  return { x, y: surfaceAt(sim, bx, bz), z };
}

/**
 * Whether a player fits with their feet in cell (x, y, z), with the cells' collision from
 * `collisionAt`: ground under them, feet and head free.
 */
function standableIn(collisionAt: (x: number, y: number, z: number) => number) {
  return (x: number, y: number, z: number): boolean => {
    if (y < 1 || y + 1 >= WORLD_HEIGHT) return false;
    const ground = collisionAt(x, y - 1, z);
    return (
      ground !== COLLISION_NONE &&
      ground !== COLLISION_LIQUID &&
      collisionAt(x, y, z) === COLLISION_NONE &&
      collisionAt(x, y + 1, z) === COLLISION_NONE
    );
  };
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
  const { x, y, z } = bed ? { x: bed.x + 0.5, y: bed.y, z: bed.z + 0.5 } : spawnPoint(sim);
  // Far away, the player waits frozen (and the client shows its loading screen) until the
  // columns there are lit.
  sim.teleport(player, x, y, z);
  // A cursor stack (a death keeps none: it went into the pack) is back in the inventory.
  stowCursor(sim, player, out);
  // Fresh gauges; a debug immunity stays.
  Object.assign(s, createSurvival(sim.registry.pack.balance), { god: s.god });
  s.health = r.health;
  s.hunger = r.hunger;
  s.thirst = r.thirst;
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
  noteChanged(sim, x, y, z);
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
