import { fuelSlotOf, outputSlotOf } from '../content/crafting.ts';
import type { Registry } from '../content/registry.ts';
import type { ProcessDef, StationDef } from '../content/schema.ts';
import { blockToColumn, toColumn } from '../world/coords.ts';
import type { StationEntity } from './blockEntities.ts';
import { COLUMN_LIT } from './ColumnPipeline.ts';
import { ticksOf } from './clock.ts';
import { editBlock } from './edits.ts';
import type { SimEvent } from './events.ts';
import { addToRange, countMatching, roomFor, takeMatching } from './inventory.ts';
import type { Simulation } from './Simulation.ts';

/**
 * Station processing (docs « Stations de transformation », tick step 9). Each tick a station runs
 * the first of its processes whose inputs are all there: the fire burns its fuel (a campfire as long
 * as it has some, a kiln or bloomery only while a process runs), the process advances while the
 * fire burns and completes into the outputs; full outputs pause it. Stations only tick inside the
 * simulation radius; one that comes back into it (its column reloaded, or a player returning)
 * catches up tick by tick from its own last tick, at most one game day.
 */

/** Stations tick within this many columns of a player (the simulation radius). */
export const SIM_RADIUS = 4;
/** Longest catch-up of a station that was out of the simulation radius: one game day. */
export const MAX_REPLAY_TICKS = 36_000;

/** The first process of the station whose inputs are all in its input slots. */
function processFor(
  station: StationEntity,
  def: StationDef,
  registry: Registry,
): ProcessDef | undefined {
  const crafting = registry.crafting;
  const processes = crafting.processesOf(def.key);
  for (let p = 0; p < processes.length; p++) {
    const process = processes[p]!;
    let ready = true;
    for (let i = 0; i < process.inputs.length && ready; i++) {
      const input = process.inputs[i]!;
      ready = countMatching(station.slots, 0, def.inputSlots, crafting, input.item) >= input.count;
    }
    if (ready) return process;
  }
  return undefined;
}

/** Lights the next fuel item of the fuel slot if the rule accepts it (its burn time in ticks). */
function ignite(station: StationEntity, def: StationDef, registry: Registry, process?: ProcessDef) {
  const slot = fuelSlotOf(def);
  const fuel = slot < 0 ? null : station.slots[slot];
  if (!fuel) return;
  const seconds = registry.crafting.burnSeconds(fuel.item, process?.fuel ?? 'any');
  if (seconds <= 0) return;
  fuel.count--;
  if (fuel.count === 0) station.slots[slot] = null;
  station.burnTicks = ticksOf(seconds);
  station.burnTicksLeft = station.burnTicks;
}

/**
 * One tick of a station. Returns false when nothing happened (no fire, no progress, the same
 * process): the station then stays as it is until something outside changes it, which ends a
 * catch-up early with the same result as ticking on.
 */
export function stepStation(station: StationEntity, def: StationDef, registry: Registry): boolean {
  const process = processFor(station, def, registry);
  let changed = false;
  const key = process?.key ?? '';
  if (key !== station.process) {
    station.process = key;
    station.progressTicks = 0;
    changed = true;
  }
  const out = outputSlotOf(def);
  const end = out + def.outputSlots;
  const ready = process !== undefined && roomFor(station.slots, registry, out, end, process.output);
  const wantsFire = def.burns === 'whileFuel' || (ready && process?.fuel !== 'none');
  if (wantsFire && station.burnTicksLeft === 0) ignite(station, def, registry, process);
  const burning = wantsFire && station.burnTicksLeft > 0;
  if (burning) {
    station.burnTicksLeft--;
    changed = true;
  }
  station.lit = burning;
  // Full outputs pause the process (its progress stays); so does a fire gone out.
  if (!ready || process === undefined || !(burning || process.fuel === 'none')) return changed;
  station.progressTicks++;
  if (station.progressTicks >= ticksOf(process.seconds)) complete(station, def, registry, process);
  return true;
}

/** Takes a process's inputs and puts its output in the station's outputs (room was checked). */
function complete(
  station: StationEntity,
  def: StationDef,
  registry: Registry,
  process: ProcessDef,
): void {
  station.progressTicks = 0;
  const inputs = process.inputs;
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    takeMatching(station.slots, 0, def.inputSlots, registry.crafting, input.item, input.count);
  }
  const out = outputSlotOf(def);
  addToRange(station.slots, registry, out, out + def.outputSlots, process.output);
}

/** `ticks` ticks of a station, stopping once a tick changes nothing (stepStation). */
export function advanceStation(
  station: StationEntity,
  def: StationDef,
  registry: Registry,
  ticks: number,
): void {
  for (let i = 0; i < ticks; i++) if (!stepStation(station, def, registry)) return;
}

/** Whether a block column is loaded, lit and within the simulation radius of some player. */
function simulated(sim: Simulation, cx: number, cz: number): boolean {
  if (sim.columnState(cx, cz) < COLUMN_LIT) return false;
  for (const player of sim.players.values()) {
    const dx = cx - blockToColumn(player.body.x);
    const dz = cz - blockToColumn(player.body.z);
    if (dx * dx + dz * dz <= SIM_RADIUS * SIM_RADIUS) return true;
  }
  return false;
}

/**
 * Tick step 9 for stations: each one inside the simulation radius advances to the current tick
 * (one tick, or its catch-up), then its block shows whether it burns.
 */
export function stepStations(sim: Simulation, out: SimEvent[]): void {
  const registry = sim.registry;
  for (const entity of sim.blockEntities.values()) {
    if (entity.kind !== 'station' || !simulated(sim, toColumn(entity.x), toColumn(entity.z)))
      continue;
    const def = registry.crafting.station(entity.station);
    const behind = sim.tick - entity.tick;
    entity.tick = sim.tick;
    if (!def) continue;
    advanceStation(entity, def, registry, Math.min(behind, MAX_REPLAY_TICKS));
    showFire(sim, entity, out);
  }
}

/** Sets the `lit` state of the station's block to its fire (light, heat, texture). */
function showFire(sim: Simulation, station: StationEntity, out: SimEvent[]): void {
  const { x, y, z } = station;
  const state = sim.world.getBlock(x, y, z);
  const lit = station.lit ? '1' : '0';
  const current = sim.registry.prop(state, 'lit');
  if (current === undefined || current === lit) return;
  editBlock(sim.world, sim.light, x, y, z, sim.registry.withState(state, 'lit', lit), out);
}
