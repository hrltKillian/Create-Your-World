import { fnv1aU32 } from '../core/hash.ts';
import type { Simulation } from './Simulation.ts';

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

function hashNumber(h: number, value: number): number {
  f64[0] = value;
  return fnv1aU32(fnv1aU32(h, u32[0]!), u32[1]!);
}

/**
 * FNV-1a over a canonical walk of the simulation state: tick, players (sorted by id) and the keys
 * and heightmaps of loaded columns. Two runs with the same commands must give the same hash.
 */
export function stateHash(sim: Simulation): number {
  let h = 0x811c9dc5;
  h = hashNumber(h, sim.tick);
  for (const id of [...sim.players.keys()].sort((a, b) => a - b)) {
    const p = sim.players.get(id)!;
    const b = p.body;
    for (const v of [
      id,
      b.x,
      b.y,
      b.z,
      b.vx,
      b.vy,
      b.vz,
      p.yaw,
      p.pitch,
      p.stamina,
      b.onGround ? 1 : 0,
      b.crouching ? 1 : 0,
    ]) {
      h = hashNumber(h, v);
    }
  }
  for (const key of [...sim.world.columns.keys()].sort((a, b) => a - b)) {
    h = hashNumber(h, key);
    const column = sim.world.columns.get(key)!;
    for (let i = 0; i < 1024; i += 17) h = fnv1aU32(h, column.heightmap[i]!);
  }
  return h;
}
