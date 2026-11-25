import type { Registry } from '../content/registry.ts';
import { hash32 } from '../core/hash.ts';
import { ticksOf } from './clock.ts';
import type { Simulation } from './Simulation.ts';

/*
 * Leaf decay (docs « Feuilles », M14): a decaying block (`BlockDef.decay`) that a player did not
 * place falls apart once no anchor (a log) lies within `radius` blocks of it, `seconds` after the
 * check was scheduled (blockUpdates.ts). A whole canopy goes within a few seconds of its trunk.
 */

/** Per-block decay facts of a pack, by block index. */
export interface DecayTables {
  /** 1 for a block that anchors decaying blocks (a log). */
  readonly anchor: Uint8Array;
  /** 1 for a decaying block. */
  readonly decays: Uint8Array;
  readonly radius: Uint8Array;
  /** Delay range of a decaying block, in ticks. */
  readonly minTicks: Uint32Array;
  readonly maxTicks: Uint32Array;
  /** The largest radius of the pack (how far an anchor's removal reaches). */
  readonly maxRadius: number;
}

const tablesOf = new WeakMap<Registry, DecayTables>();

/** The decay facts of a registry's pack (built once). */
export function decayTables(registry: Registry): DecayTables {
  let tables = tablesOf.get(registry);
  if (tables) return tables;
  const blocks = registry.pack.blocks;
  const anchor = new Uint8Array(blocks.length);
  const decays = new Uint8Array(blocks.length);
  const radius = new Uint8Array(blocks.length);
  const minTicks = new Uint32Array(blocks.length);
  const maxTicks = new Uint32Array(blocks.length);
  const index = new Map(blocks.map((block, i) => [block.key as string, i]));
  let maxRadius = 0;
  blocks.forEach((block, i) => {
    const decay = block.decay;
    if (!decay) return;
    decays[i] = 1;
    radius[i] = decay.radius;
    minTicks[i] = ticksOf(decay.seconds[0]);
    maxTicks[i] = ticksOf(decay.seconds[1]);
    maxRadius = Math.max(maxRadius, decay.radius);
    for (const key of decay.anchors) anchor[index.get(key)!] = 1;
  });
  tables = { anchor, decays, radius, minTicks, maxTicks, maxRadius };
  tablesOf.set(registry, tables);
  return tables;
}

/** The delay before a decaying block's check, from the seed, its cell and the tick. */
export function decayDelay(
  sim: Simulation,
  x: number,
  y: number,
  z: number,
  state: number,
): number {
  const t = decayTables(sim.registry);
  const block = sim.registry.tables.blockOf[state]!;
  const span = t.maxTicks[block]! - t.minTicks[block]! + 1;
  return t.minTicks[block]! + (hash32(hash32(sim.ctx.seedHash, x, y, z), sim.tick) % span);
}

/**
 * Whether the decaying block at a cell should fall apart now: it decays, was not placed by a
 * player, and no anchor (a log) lies within its radius (Manhattan distance). Generated crowns have
 * gaps, so the rule does not ask for a path of leaves; a felled trunk still takes its canopy.
 */
export function checkDecay(sim: Simulation, x: number, y: number, z: number): boolean {
  const registry = sim.registry;
  const t = decayTables(registry);
  const world = sim.world;
  const blockOf = registry.tables.blockOf;
  const state = world.getBlock(x, y, z);
  const block = blockOf[state]!;
  if (!t.decays[block] || registry.prop(state, 'placed') === '1') return false;
  const r = t.radius[block]!;
  for (let dy = -r; dy <= r; dy++) {
    const ry = r - Math.abs(dy);
    for (let dz = -ry; dz <= ry; dz++) {
      const rz = ry - Math.abs(dz);
      for (let dx = -rz; dx <= rz; dx++) {
        const near = world.getBlock(x + dx, y + dy, z + dz);
        // An unloaded column may hold the trunk: never decay on what is not known.
        if (t.anchor[blockOf[near]!] || near === world.outside) return false;
      }
    }
  }
  return true;
}
