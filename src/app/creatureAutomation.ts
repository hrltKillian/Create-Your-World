import { type CreatureCensus, creatureCensus } from '../sim/creatures.ts';
import type { SpawnLogEntry } from '../sim/spawning.ts';
import type { App } from './App.ts';
import { sendNow } from './automation.ts';

/**
 * Creature automation (M10) shared by the debug hook, the benchmarks and the selftests: placing and
 * killing creatures by debug command (applied at once, without a tick), what each one is doing,
 * the census and the log of hostile spawns.
 */

/**
 * Places a creature of the pack (its key; feet at `y`, or `'surface'`: on the ground there),
 * facing the player, now (`debug.spawn`); returns its entity id, or null when it was refused
 * (unknown creature, unloaded column, debugging off).
 */
export function placeCreature(
  app: App,
  creature: string,
  x: number,
  y: number | 'surface',
  z: number,
): number | null {
  const view = app.session?.host.view;
  if (!view) return null;
  // Entity ids only grow: the new creature is the one past every id there now.
  let last = 0;
  for (const id of view.entities.keys()) last = Math.max(last, id);
  sendNow(app, { type: 'debug.spawn', creature, x, y, z });
  for (const [id, entity] of view.entities)
    if (id > last && entity.kind === 'creature' && entity.creature === creature) return id;
  return null;
}

/**
 * Kills a creature now (`debug.killCreature`), burrowing away or not: it falls over and drops its
 * loot, then is removed after its dying time. Returns false when there is no such living creature
 * (none, or one already dying).
 */
export function killCreature(app: App, id: number): boolean {
  const view = app.session?.host.view;
  const before = view?.entities.get(id);
  if (before?.kind !== 'creature' || before.mode === 'dying') return false;
  sendNow(app, { type: 'debug.killCreature', id });
  const after = view?.entities.get(id);
  return after?.kind !== 'creature' || after.mode === 'dying';
}

/** What one creature is doing, as automation reads it. */
export interface CreatureView {
  readonly id: number;
  readonly creature: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly health: number;
  readonly mode: string;
  /** Entity id of the player it is after (−1: none). */
  readonly target: number;
  readonly sees: boolean;
  readonly watched: boolean;
  readonly herd: number;
  readonly cave: boolean;
}

/**
 * Every creature in the simulation (dying and burrowing ones too, not those parked with an unloaded
 * column), oldest first; null without a world.
 */
export function creatureList(app: App): CreatureView[] | null {
  const view = app.session?.host.view;
  if (!view) return null;
  const list: CreatureView[] = [];
  for (const c of view.entities.values()) {
    if (c.kind !== 'creature') continue;
    const { x, y, z } = c.body;
    const { id, creature, yaw, health, mode, target, sees, watched, herd, cave } = c;
    list.push({ id, creature, x, y, z, yaw, health, mode, target, sees, watched, herd, cave });
  }
  return list;
}

/** The living creatures: total, hostiles on the surface and in caves, per creature key. */
export function census(app: App): CreatureCensus | null {
  const view = app.session?.host.view;
  return view ? creatureCensus(view.entities, view.registry) : null;
}

/** The last hostile spawns, oldest first (copies): tick, creature, feet, effective light, cave. */
export function spawnLog(app: App): SpawnLogEntry[] | null {
  const view = app.session?.host.view;
  return view ? view.spawnLog.map((entry) => ({ ...entry })) : null;
}
