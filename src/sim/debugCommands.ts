import { insideBorder, toColumn, WORLD_HEIGHT } from '../world/coords.ts';
import { setMode } from './ai/behaviours.ts';
import { removeBlockEntity } from './blockEntities.ts';
import { openBlockEntity } from './blockEntityCommands.ts';
import { forgetCell } from './blockRemoval.ts';
import { hurtCreature } from './combat.ts';
import { finite, reject, validCell } from './commandRules.ts';
import type { DebugCommand, DebugStat } from './commands.ts';
import { spawnCreature } from './creatures.ts';
import { writeBlock } from './edits.ts';
import type { SimEvent } from './events.ts';
import { freshStack } from './inventory.ts';
import { giveItems } from './inventoryCommands.ts';
import { PHYSICS } from './physics.ts';
import { type PlayerState, STAMINA } from './player.ts';
import { staminaMax } from './progression.ts';
import type { Simulation } from './Simulation.ts';
import { surfaceAt } from './surface.ts';
import { clampGauge, DEATH_CAUSES, GAUGES } from './survival.ts';
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
  if (command.type === 'debug.spawn') {
    spawn(sim, playerId, command, out);
    return;
  }
  if (command.type === 'debug.killCreature') {
    const c = sim.entities.get(command.id);
    if (c?.kind !== 'creature' || c.mode === 'dying')
      reject(out, playerId, command.type, 'no creature');
    else {
      // All its health, whatever its armour, a recent blow or its burrowing away (no attacker, no
      // knockback): it dies where it is.
      c.invulnerable = 0;
      if (c.mode === 'burrow') setMode(c, 'idle');
      hurtCreature(sim, c, c.health, c.body.x, c.body.z, 0, -1, out);
    }
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

/** Sets a gauge, clamped to its range (survival.ts `clampGauge`); false for an unknown gauge. */
function setStat(sim: Simulation, player: PlayerState, stat: DebugStat, value: number): boolean {
  if (stat === 'stamina') {
    const top = staminaMax(player, sim.registry.pack.balance, STAMINA.max);
    player.stamina = Math.max(0, Math.min(top, value));
    return true;
  }
  if (!GAUGES.includes(stat)) return false;
  player.survival[stat] = clampGauge(stat, value, sim.registry.pack.balance, player.survival);
  return true;
}

/** Places a creature (in a loaded column, inside the world), facing the player who asked. */
function spawn(
  sim: Simulation,
  playerId: number,
  c: Extract<DebugCommand, { type: 'debug.spawn' }>,
  out: SimEvent[],
): void {
  const def = typeof c.creature === 'string' ? sim.registry.creature(c.creature) : undefined;
  const y = c.y === 'surface' ? 0 : c.y;
  if (!def) reject(out, playerId, c.type, 'unknown creature');
  else if (!finite(c.x, y, c.z) || !insideBorder(c.x, c.z))
    reject(out, playerId, c.type, 'invalid');
  else if (!sim.world.getColumn(toColumn(Math.floor(c.x)), toColumn(Math.floor(c.z))))
    reject(out, playerId, c.type, 'not loaded');
  else {
    const creature = spawnCreature(sim, def, c.x, teleportY(sim, c.x, c.y, c.z), c.z);
    const player = sim.players.get(playerId);
    if (!player) return;
    creature.yaw = Math.atan2(c.x - player.body.x, c.z - player.body.z);
    creature.prevYaw = creature.yaw;
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
 * block entities there spill what they hold, and the cells are forgotten as when broken.
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
        const before = sim.world.getBlock(x, y, z);
        removeBlockEntity(sim, x, y, z);
        writeBlock(sim.world, sim.light, x, y, z, state);
        forgetCell(sim, x, y, z, before);
      }
      written++;
    }
  }
  if (written > 0) out.push({ type: 'blocksChanged', x0, y0, z0, x1, y1, z1 });
}

/** Feet height of a teleport: 'surface' is the top of the ground (`surfaceAt`). */
function teleportY(sim: Simulation, x: number, y: number | 'surface', z: number): number {
  if (y !== 'surface') return Math.max(1, Math.min(WORLD_HEIGHT - PHYSICS.height, y));
  return surfaceAt(sim, Math.floor(x), Math.floor(z));
}
