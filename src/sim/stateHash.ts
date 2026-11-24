import { fnv1aString, fnv1aU32 } from '../core/hash.ts';
import { SECTION_VOLUME } from '../world/coords.ts';
import type { Section } from '../world/Section.ts';
import type { Simulation } from './Simulation.ts';

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

function hashNumber(h: number, value: number): number {
  f64[0] = value;
  return fnv1aU32(fnv1aU32(h, u32[0]!), u32[1]!);
}

/** JSON with object keys sorted: the canonical form of a plain record. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const record = v as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(record).sort()) sorted[k] = record[k];
      return sorted;
    }
    return v;
  });
}

/** Run-length walk of a lazily stored channel: a uniform section and its expanded array agree. */
function hashRuns(h: number, array: Uint16Array | Uint8Array | null, uniform: number): number {
  if (!array) return fnv1aU32(fnv1aU32(h, uniform), SECTION_VOLUME);
  let value = array[0]!;
  let run = 0;
  for (let i = 0; i < SECTION_VOLUME; i++) {
    const v = array[i]!;
    if (v === value) {
      run++;
      continue;
    }
    h = fnv1aU32(fnv1aU32(h, value), run);
    value = v;
    run = 1;
  }
  return fnv1aU32(fnv1aU32(h, value), run);
}

function hashSection(h: number, section: Section): number {
  h = hashRuns(h, section.blocks, section.uniformBlock);
  return hashRuns(h, section.light, section.uniformLight);
}

/**
 * FNV-1a over a canonical serialization of the simulation state: tick, clock, entity counter, every
 * entity record (canonical JSON, by id), the creatures parked with unloaded columns (by column key),
 * every block entity (by cell key), every loaded column (by key) with its pipeline state,
 * persisted sections, voxels, light, heightmap and biomes, and the saved sections of the unloaded
 * ones (edit store, by key). Storage details (uniform or expanded sections) do not change it.
 * Two runs with the same commands must give the same hash.
 */
export function stateHash(sim: Simulation): number {
  let h = 0x811c9dc5;
  h = hashNumber(h, sim.tick);
  h = hashNumber(h, sim.time.ticks);
  h = fnv1aU32(h, sim.time.frozen ? 1 : 0);
  h = hashNumber(h, sim.nextEntityId);
  for (const id of [...sim.entities.keys()].sort((a, b) => a - b)) {
    h = fnv1aString(canonicalJson(sim.entities.get(id)), h);
  }
  for (const key of [...sim.parked.keys()].sort((a, b) => a - b)) {
    h = hashNumber(h, key);
    for (const c of sim.parked.get(key)!) h = fnv1aString(canonicalJson(c), h);
  }
  for (const key of [...sim.blockEntities.keys()].sort((a, b) => a - b)) {
    h = fnv1aString(canonicalJson(sim.blockEntities.get(key)), h);
  }
  for (const key of [...sim.world.columns.keys()].sort((a, b) => a - b)) {
    const column = sim.world.columns.get(key)!;
    h = hashNumber(h, key);
    h = fnv1aU32(h, sim.columnState(column.cx, column.cz));
    h = fnv1aU32(h, column.persisted);
    for (const section of column.sections) h = hashSection(h, section);
    for (let i = 0; i < 1024; i++) h = fnv1aU32(h, column.heightmap[i]! & 0xffff);
    for (let i = 0; i < 1024; i++) h = fnv1aU32(h, column.biomes[i]!);
  }
  for (const key of [...sim.edits.keys()].sort((a, b) => a - b)) {
    h = hashNumber(h, key);
    for (const saved of sim.edits.get(key)!) {
      h = fnv1aU32(h, saved.sy);
      h = hashRuns(h, saved.blocks, saved.uniformBlock);
    }
  }
  return h;
}
