import { FLAG_REPLACEABLE, FLAG_SOLID, type Registry, SHAPE_LIQUID } from '../content/registry.ts';
import { BY_WORLD, removeBlock } from './blockRemoval.ts';
import { UPDATE_LIQUID } from './blockUpdates.ts';
import { ticksOf } from './clock.ts';
import { editBlock } from './edits.ts';
import type { SimEvent } from './events.ts';
import type { Simulation } from './Simulation.ts';

/*
 * Flowing liquids (docs plan v2 « M15 — L'eau »), the reference game's rules, run as a block update
 * (blockUpdates.ts, kind LIQUID) `flow.seconds` after a change nearby:
 * - a liquid that `hardens` turns to rock first where another liquid touches it (lava and water);
 * - a flowing cell (not a source) takes what its neighbours give it: a new source between two
 *   sources over solid ground or a source (`infinite`), a falling flow under the same liquid,
 *   `flow.step` levels thinner than its best horizontal neighbour, or nothing: it dries up;
 * - then it spreads: down first (a falling flow), and sideways when it cannot fall, or when it is a
 *   source (over a drop only when 3 sources surround it), one level thinner, towards the sides with the
 *   nearest drop within `holeSearch` blocks (every open side when none is that near);
 * - a liquid flows into air, a plant (washed away with its drops) or a thinner flow of itself, never
 *   into another liquid or an unloaded cell. Sources never drain.
 * Every write schedules the cell and its liquid neighbours again, after the liquid's delay.
 * Amounts: a source or a falling flow holds 8, level n holds 8 − n.
 */

/** A flowing liquid of the pack: its states and delay. */
interface LiquidKind {
  readonly block: number;
  readonly holeSearch: number;
  readonly infinite: boolean;
  readonly delay: number;
  /** Levels lost per block spread (`flow.step`). */
  readonly step: number;
  /** States it hardens into where another liquid touches it (-1: none): source, flow. */
  readonly hardenSource: number;
  readonly hardenFlow: number;
  /** States by level 0–7 (not falling); level 0 is the source. */
  readonly levels: readonly number[];
  readonly falling: number;
}

interface LiquidTables {
  /** Flowing liquid by block index (undefined: not one). */
  readonly kinds: readonly (LiquidKind | undefined)[];
  /** Amount held by state: 8 source or falling, 8 − level flowing, 0 not a flowing liquid. */
  readonly amount: Uint8Array;
}

const tablesOf = new WeakMap<Registry, LiquidTables>();

/** The pack's flowing liquids, memoised per registry. */
export function liquidTables(registry: Registry): LiquidTables {
  const known = tablesOf.get(registry);
  if (known) return known;
  const amount = new Uint8Array(registry.tables.blockOf.length);
  const kinds = registry.blocks.map((block, index): LiquidKind | undefined => {
    const flow = block.liquid?.flow;
    if (!flow) return undefined;
    const source = registry.defaultState(block.key);
    const levels = Array.from({ length: 8 }, (_, level) =>
      registry.withState(source, 'level', String(level)),
    );
    const falling = registry.withState(levels[1]!, 'falling', '1');
    const hardens = block.liquid?.hardens;
    return {
      block: index,
      holeSearch: flow.holeSearch,
      infinite: flow.infinite,
      delay: Math.max(1, ticksOf(flow.seconds)),
      step: flow.step ?? 1,
      hardenSource: hardens ? registry.defaultState(hardens.source) : -1,
      hardenFlow: hardens ? registry.defaultState(hardens.flow) : -1,
      levels,
      falling,
    };
  });
  for (let state = 0; state < amount.length; state++) {
    if (!kinds[registry.tables.blockOf[state]!]) continue;
    amount[state] =
      registry.prop(state, 'falling') === '1' ? 8 : 8 - Number(registry.prop(state, 'level'));
  }
  const tables = { kinds, amount };
  tablesOf.set(registry, tables);
  return tables;
}

/** Horizontal sides as x, z pairs, then the 6 neighbours as x, y, z triples. */
const SIDES = [1, 0, -1, 0, 0, 1, 0, -1];
const AROUND = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];

/** Scratch: the drop distance of each horizontal side (−1: closed). */
const distances = new Float64Array(4);
const NO_DROP = 1000;

/** Schedules the liquid updates of a cell and its 6 neighbours that hold a flowing liquid. */
export function noteLiquids(sim: Simulation, x: number, y: number, z: number): void {
  scheduleLiquid(sim, x, y, z);
  for (let i = 0; i < 18; i += 3)
    scheduleLiquid(sim, x + AROUND[i]!, y + AROUND[i + 1]!, z + AROUND[i + 2]!);
}

function scheduleLiquid(sim: Simulation, x: number, y: number, z: number): void {
  const registry = sim.registry;
  const state = sim.world.getBlock(x, y, z);
  const kind = liquidTables(registry).kinds[registry.tables.blockOf[state]!];
  if (kind) sim.blockUpdates.schedule(x, y, z, UPDATE_LIQUID, sim.tick + kind.delay);
}

/** The liquid update of a cell: it takes its level from its neighbours, then spreads. */
export function updateLiquid(
  sim: Simulation,
  x: number,
  y: number,
  z: number,
  out: SimEvent[],
): void {
  const registry = sim.registry;
  let state = sim.world.getBlock(x, y, z);
  const kind = liquidTables(registry).kinds[registry.tables.blockOf[state]!];
  if (!kind) return;
  if (kind.hardenSource >= 0 && touchesOtherLiquid(sim, kind, x, y, z)) {
    harden(sim, kind, x, y, z, state === kind.levels[0], out);
    return;
  }
  if (state !== kind.levels[0]) {
    const next = flowFrom(sim, kind, x, y, z);
    if (next !== state) {
      pour(sim, kind, x, y, z, next, out);
      if (next === registry.air) return;
      state = next;
    }
  }
  spread(sim, kind, x, y, z, state, out);
}

/** What a flowing cell holds given its neighbours (air once nothing feeds it). */
function flowFrom(sim: Simulation, kind: LiquidKind, x: number, y: number, z: number): number {
  const { world, registry } = sim;
  const amount = liquidTables(registry).amount;
  const source = kind.levels[0]!;
  let best = 0;
  let sources = 0;
  for (let i = 0; i < 8; i += 2) {
    const there = world.getBlock(x + SIDES[i]!, y, z + SIDES[i + 1]!);
    if (registry.tables.blockOf[there] !== kind.block) continue;
    if (there === source) sources++;
    if (amount[there]! > best) best = amount[there]!;
  }
  if (kind.infinite && sources >= 2) {
    const below = world.getBlock(x, y - 1, z);
    if ((registry.tables.flags[below]! & FLAG_SOLID) !== 0 || below === source) return source;
  }
  if (registry.tables.blockOf[world.getBlock(x, y + 1, z)] === kind.block) return kind.falling;
  // One step thinner than the best neighbour: amount best − step, level 8 − (best − step).
  return best <= kind.step ? registry.air : kind.levels[8 - best + kind.step]!;
}

/** Whether a liquid that hardens has another liquid beside, above or under it. */
function touchesOtherLiquid(
  sim: Simulation,
  kind: LiquidKind,
  x: number,
  y: number,
  z: number,
): boolean {
  const tables = sim.registry.tables;
  for (let i = 0; i < 18; i += 3) {
    const there = sim.world.getBlock(x + AROUND[i]!, y + AROUND[i + 1]!, z + AROUND[i + 2]!);
    if (tables.shape[there] === SHAPE_LIQUID && tables.blockOf[there] !== kind.block) return true;
  }
  return false;
}

/**
 * The liquid turns to rock where another liquid touches it (lava meeting water): a source into
 * its `hardens.source`, a flow into its `hardens.flow`, with a hiss (the pack's `hardens` sound).
 */
function harden(
  sim: Simulation,
  kind: LiquidKind,
  x: number,
  y: number,
  z: number,
  source: boolean,
  out: SimEvent[],
): void {
  const state = source ? kind.hardenSource : kind.hardenFlow;
  if (!editBlock(sim.world, sim.light, x, y, z, state, out)) return;
  noteLiquids(sim, x, y, z);
  const sfx = sim.registry.pack.sounds?.hardens;
  if (sfx) out.push({ type: 'sound', sfx, x: x + 0.5, y: y + 0.5, z: z + 0.5 });
}

/**
 * Whether a liquid can pass through a cell: air, a plant or the same liquid (not an unloaded cell,
 * another liquid or anything solid).
 */
function passable(sim: Simulation, kind: LiquidKind, state: number): boolean {
  const { registry, world } = sim;
  if (state === world.outside) return false;
  if (registry.tables.blockOf[state] === kind.block) return true;
  if (registry.tables.shape[state] === SHAPE_LIQUID) return false;
  return state === registry.air || (registry.tables.flags[state]! & FLAG_REPLACEABLE) !== 0;
}

/** Whether a liquid holding `amount` may flow into a cell: passable, and not as full already. */
function canTake(sim: Simulation, kind: LiquidKind, state: number, amount: number): boolean {
  if (!passable(sim, kind, state)) return false;
  if (sim.registry.tables.blockOf[state] !== kind.block) return true;
  return state !== kind.levels[0] && liquidTables(sim.registry).amount[state]! < amount;
}

/** Writes a liquid state (or air) into a cell, washing a plant away, and schedules around it. */
function pour(
  sim: Simulation,
  kind: LiquidKind,
  x: number,
  y: number,
  z: number,
  state: number,
  out: SimEvent[],
): void {
  const registry = sim.registry;
  const there = sim.world.getBlock(x, y, z);
  if (there !== registry.air && registry.tables.blockOf[there] !== kind.block)
    removeBlock(sim, BY_WORLD, x, y, z, true, out);
  if (editBlock(sim.world, sim.light, x, y, z, state, out)) noteLiquids(sim, x, y, z);
}

/** Spreads a liquid cell: down first, else sideways towards the nearest drop. */
function spread(
  sim: Simulation,
  kind: LiquidKind,
  x: number,
  y: number,
  z: number,
  state: number,
  out: SimEvent[],
): void {
  const world = sim.world;
  const source = state === kind.levels[0];
  const below = world.getBlock(x, y - 1, z);
  if (canTake(sim, kind, below, 8)) {
    pour(sim, kind, x, y - 1, z, kind.falling, out);
    if (!source || sourcesBeside(sim, kind, x, y, z) < 3) return;
  } else if (!source && passable(sim, kind, below)) return;
  const held = state === kind.falling ? 8 : liquidTables(sim.registry).amount[state]!;
  const amount = held - kind.step;
  if (amount <= 0) return;
  // The nearest drop counts every side the liquid passes, the ones it already fills too (the
  // reference game's rule: water beside a drop it already feeds goes nowhere else).
  let nearest = NO_DROP;
  for (let i = 0; i < 4; i++) {
    const there = world.getBlock(x + SIDES[i * 2]!, y, z + SIDES[i * 2 + 1]!);
    distances[i] =
      passable(sim, kind, there) && there !== kind.levels[0]
        ? dropDistance(sim, kind, x + SIDES[i * 2]!, y, z + SIDES[i * 2 + 1]!, i, 1)
        : -1;
    if (distances[i]! >= 0 && distances[i]! < nearest) nearest = distances[i]!;
  }
  const next = kind.levels[8 - amount]!;
  for (let i = 0; i < 4; i++) {
    if (distances[i] !== nearest) continue;
    const nx = x + SIDES[i * 2]!;
    const nz = z + SIDES[i * 2 + 1]!;
    if (canTake(sim, kind, world.getBlock(nx, y, nz), amount))
      pour(sim, kind, nx, y, nz, next, out);
  }
}

/** How many sources of the liquid stand beside a cell. */
function sourcesBeside(sim: Simulation, kind: LiquidKind, x: number, y: number, z: number): number {
  let n = 0;
  for (let i = 0; i < 8; i += 2)
    if (sim.world.getBlock(x + SIDES[i]!, y, z + SIDES[i + 1]!) === kind.levels[0]) n++;
  return n;
}

/**
 * Steps from a side cell to the nearest drop (0: that cell is over one), walking at most
 * `holeSearch` blocks through passable cells and never straight back (`from`: the side it was
 * entered by); NO_DROP when none is that near. At most 4 · 3³ cells for a search of 4.
 */
function dropDistance(
  sim: Simulation,
  kind: LiquidKind,
  x: number,
  y: number,
  z: number,
  from: number,
  depth: number,
): number {
  if (passable(sim, kind, sim.world.getBlock(x, y - 1, z))) return 0;
  if (depth >= kind.holeSearch) return NO_DROP;
  let best = NO_DROP;
  for (let i = 0; i < 4; i++) {
    // Sides come in opposite pairs (0/1, 2/3): i ^ 1 is the way back.
    if (i === (from ^ 1)) continue;
    const nx = x + SIDES[i * 2]!;
    const nz = z + SIDES[i * 2 + 1]!;
    const there = sim.world.getBlock(nx, y, nz);
    if (!passable(sim, kind, there) || there === kind.levels[0]) continue;
    const d = 1 + dropDistance(sim, kind, nx, y, nz, i, depth + 1);
    if (d < best) best = d;
  }
  return best;
}
