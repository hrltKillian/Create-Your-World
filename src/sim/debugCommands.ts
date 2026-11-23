import type { Registry } from '../content/registry.ts';
import { columnIndex, insideBorder, toColumn, toLocal, WORLD_HEIGHT } from '../world/coords.ts';
import { type GenContext, surfaceY } from '../world/gen/generateColumn.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import { finite, reject } from './commandRules.ts';
import type { DebugCommand } from './commands.ts';
import type { SimEvent } from './events.ts';
import { PHYSICS } from './physics.ts';
import { STAMINA } from './player.ts';
import type { Simulation } from './Simulation.ts';

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
    fill(sim.world, sim.registry, playerId, command, out);
    return;
  }
  const player = sim.players.get(playerId);
  if (!player) return;
  if (command.type === 'debug.teleport') {
    const y = command.y === 'surface' ? 0 : command.y;
    if (!finite(command.x, y, command.z) || !insideBorder(command.x, command.z)) {
      reject(out, playerId, command.type, 'invalid');
      return;
    }
    const ty = teleportY(sim.world, sim.ctx, command.x, command.y, command.z);
    sim.teleport(player, command.x, ty, command.z);
  } else if (command.stat === 'stamina' && finite(command.value)) {
    player.stamina = Math.max(0, Math.min(STAMINA.max, command.value));
  }
}

/** Debug fill of a box of loaded blocks (no light update before the light engine lands). */
function fill(
  world: VoxelWorld,
  registry: Registry,
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
  const state = registry.stateIdOrUnknown(c.state);
  let written = 0;
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      if (!world.getColumn(toColumn(x), toColumn(z))) continue;
      for (let y = y0; y <= y1; y++) world.setBlock(x, y, z, state);
      written++;
    }
  }
  if (written > 0) out.push({ type: 'blocksChanged', x0, y0, z0, x1, y1, z1 });
}

/** Feet height of a teleport: 'surface' is the top of the ground (loaded heightmap or analytic height). */
function teleportY(
  world: VoxelWorld,
  ctx: GenContext,
  x: number,
  y: number | 'surface',
  z: number,
): number {
  if (y !== 'surface') return Math.max(1, Math.min(WORLD_HEIGHT - PHYSICS.height, y));
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  const column = world.getColumn(toColumn(bx), toColumn(bz));
  return column ? column.heightmap[columnIndex(toLocal(bx), toLocal(bz))]! : surfaceY(ctx, bx, bz);
}
