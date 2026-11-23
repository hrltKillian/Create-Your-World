import {
  columnIndex,
  columnKey,
  insideBorder,
  localIndex,
  SECTION_SIZE,
  SECTIONS_PER_COLUMN,
  toColumn,
  toLocal,
  WORLD_HEIGHT,
} from '../world/coords.ts';
import { surfaceY } from '../world/gen/generateColumn.ts';
import type { SavedSection } from '../world/protocol.ts';
import { removeBlockEntity } from './blockEntities.ts';
import { openBlockEntity } from './blockEntityCommands.ts';
import { finite, reject, validCell } from './commandRules.ts';
import type { DebugCommand, DebugStat } from './commands.ts';
import { writeBlock } from './edits.ts';
import type { SimEvent } from './events.ts';
import { freshStack } from './inventory.ts';
import { giveItems } from './inventoryCommands.ts';
import { PHYSICS } from './physics.ts';
import { type PlayerState, STAMINA } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { DEATH_CAUSES } from './survival.ts';
import { setHour } from './time.ts';

/** Largest box a debug fill may touch. */
const FILL_LIMIT = 65_536;

/** Applies a debug.* command; the caller has checked that the world allows debugging. */
export function applyDebugCommand(
  sim: Simulation,
  playerId: number,
  command: DebugCommand,
  out: SimEvent[],
): void {
  if (command.type === 'debug.fill') {
    fill(sim, playerId, command, out);
    return;
  }
  if (command.type === 'debug.setTime') {
    if (!setHour(sim.time, command.hours)) reject(out, playerId, command.type, 'invalid');
    return;
  }
  if (command.type === 'debug.freezeTime') {
    if (typeof command.frozen === 'boolean') sim.time.frozen = command.frozen;
    else reject(out, playerId, command.type, 'invalid');
    return;
  }
  const player = sim.players.get(playerId);
  if (!player) return;
  if (command.type === 'debug.give') {
    give(sim, player, command, out);
  } else if (command.type === 'debug.open') {
    // The aimed path: reach and the other player's screen still refuse, the sight does not.
    const { x, y, z } = command;
    const refusal = validCell(command)
      ? openBlockEntity(sim, player, x, y, z, out, true)
      : 'invalid';
    if (refusal) reject(out, playerId, command.type, refusal);
  } else if (command.type === 'debug.teleport') {
    const y = command.y === 'surface' ? 0 : command.y;
    if (!finite(command.x, y, command.z) || !insideBorder(command.x, command.z)) {
      reject(out, playerId, command.type, 'invalid');
      return;
    }
    const ty = teleportY(sim, command.x, command.y, command.z);
    sim.teleport(player, command.x, ty, command.z);
  } else if (command.type === 'debug.kill') {
    if (!DEATH_CAUSES.includes(command.cause)) reject(out, playerId, command.type, 'invalid');
    else if (player.survival.health > 0) {
      player.survival.health = 0;
      player.survival.cause = command.cause;
    }
  } else if (command.type === 'debug.god') {
    if (typeof command.on === 'boolean') player.survival.god = command.on;
    else reject(out, playerId, command.type, 'invalid');
  } else if (!finite(command.value) || !setStat(sim, player, command.stat, command.value)) {
    reject(out, playerId, command.type, 'invalid');
  }
}

/** Sets a gauge, clamped to its range; false for an unknown gauge. */
function setStat(sim: Simulation, player: PlayerState, stat: DebugStat, value: number): boolean {
  const b = sim.registry.pack.balance;
  const s = player.survival;
  const clamp = (max: number, min = 0) => Math.max(min, Math.min(max, value));
  switch (stat) {
    case 'stamina':
      player.stamina = clamp(STAMINA.max);
      return true;
    case 'health':
      s.health = clamp(b.health.max);
      return true;
    case 'hunger':
      s.hunger = clamp(b.hunger.max);
      return true;
    case 'thirst':
      s.thirst = clamp(b.thirst.max);
      return true;
    case 'temperature':
      s.temperature = clamp(b.temperature.limit, -b.temperature.limit);
      return true;
    case 'toxicity':
      s.toxicity = clamp(b.toxicity.max);
      return true;
    case 'breath':
      s.breath = clamp(b.breath.seconds);
      return true;
    default:
      return false;
  }
}

/** Largest debug.give at once. */
const GIVE_LIMIT = 10_000;

function give(
  sim: Simulation,
  player: PlayerState,
  c: Extract<DebugCommand, { type: 'debug.give' }>,
  out: SimEvent[],
): void {
  const id = sim.registry.itemId(c.item);
  if (id < 0) {
    reject(out, player.playerId, c.type, 'unknown item');
    return;
  }
  if (!Number.isInteger(c.count) || c.count < 1 || c.count > GIVE_LIMIT) {
    reject(out, player.playerId, c.type, 'invalid');
    return;
  }
  giveItems(sim, player, freshStack(sim.registry, c.item, c.count), out);
}

/**
 * Debug fill of a box of loaded blocks (heightmap and light follow, as for gameplay edits); the
 * block entities there spill what they hold.
 */
function fill(
  sim: Simulation,
  playerId: number,
  c: Extract<DebugCommand, { type: 'debug.fill' }>,
  out: SimEvent[],
): void {
  if (!finite(c.x0, c.y0, c.z0, c.x1, c.y1, c.z1)) {
    reject(out, playerId, c.type, 'invalid');
    return;
  }
  const x0 = Math.floor(Math.min(c.x0, c.x1));
  const x1 = Math.floor(Math.max(c.x0, c.x1));
  const y0 = Math.max(0, Math.floor(Math.min(c.y0, c.y1)));
  const y1 = Math.min(WORLD_HEIGHT - 1, Math.floor(Math.max(c.y0, c.y1)));
  const z0 = Math.floor(Math.min(c.z0, c.z1));
  const z1 = Math.floor(Math.max(c.z0, c.z1));
  if (y0 > y1 || !insideBorder(x0, z0) || !insideBorder(x1, z1)) {
    reject(out, playerId, c.type, 'outside the world');
    return;
  }
  if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > FILL_LIMIT) {
    reject(out, playerId, c.type, 'too large');
    return;
  }
  const state = sim.registry.stateIdOrUnknown(c.state);
  let written = 0;
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      if (!sim.world.getColumn(toColumn(x), toColumn(z))) continue;
      for (let y = y0; y <= y1; y++) {
        removeBlockEntity(sim, x, y, z);
        writeBlock(sim.world, sim.light, x, y, z, state);
      }
      written++;
    }
  }
  if (written > 0) out.push({ type: 'blocksChanged', x0, y0, z0, x1, y1, z1 });
}

/**
 * Feet height of a teleport: 'surface' is the top of the ground, resolved at once: the heightmap
 * of a loaded column, else the analytic height (generated decorations aside), under the saved
 * sections of an edited column, so the player never lands inside what was built there.
 */
function teleportY(sim: Simulation, x: number, y: number | 'surface', z: number): number {
  if (y !== 'surface') return Math.max(1, Math.min(WORLD_HEIGHT - PHYSICS.height, y));
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  const column = sim.world.getColumn(toColumn(bx), toColumn(bz));
  if (column) return column.heightmap[columnIndex(toLocal(bx), toLocal(bz))]!;
  const ground = surfaceY(sim.ctx, bx, bz);
  const saved = sim.edits.get(columnKey(toColumn(bx), toColumn(bz)));
  return saved ? savedSurface(saved, toLocal(bx), toLocal(bz), ground, sim.world.air) : ground;
}

/**
 * Top of an unloaded column with saved sections (the highest non-air block + 1, as a heightmap):
 * a saved section gives its blocks, any other one is the generated ground below `ground`.
 */
function savedSurface(
  saved: readonly SavedSection[],
  lx: number,
  lz: number,
  ground: number,
  air: number,
): number {
  for (let sy = SECTIONS_PER_COLUMN - 1; sy >= 0; sy--) {
    const section = saved.find((s) => s.sy === sy);
    for (let ly = SECTION_SIZE - 1; ly >= 0; ly--) {
      const y = sy * SECTION_SIZE + ly;
      if (section === undefined) {
        if (y < ground) return y + 1;
        continue;
      }
      const state =
        section.blocks === null ? section.uniformBlock : section.blocks[localIndex(lx, ly, lz)]!;
      if (state !== air) return y + 1;
    }
  }
  return 0;
}
