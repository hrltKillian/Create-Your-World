import type { Registry } from '../content/registry.ts';
import { lockWorld, type WorldLock } from '../platform/worldLock.ts';
import { restoreSim, type StoredColumns, type WorldInfo } from '../sim/persistence.ts';
import type { ColumnSource } from '../sim/ports.ts';
import { Simulation } from '../sim/Simulation.ts';
import type { Storage, WorldRecord } from '../sim/storage.ts';
import { type NewWorldForm, WORLD_NAME_MAX } from '../ui/screens/newWorld.ts';
import type { Deflater } from '../world/codec/columnRecord.ts';
import { SaveVersionError } from '../world/codec/migrations.ts';
import type { WorldType } from '../world/gen/generateColumn.ts';

/** Connection id of the local player. */
export const PLAYER_ID = 1;

/** A world taken by this tab, ready to play: its lock, its simulation and how to save it. */
export interface WorldSlot {
  readonly info: WorldInfo;
  readonly sim: Simulation;
  readonly lock: WorldLock;
  /** The column records in storage. */
  readonly stored: StoredColumns;
  /** The first save writes every column (a new world, or one saved with another pack). */
  readonly full: boolean;
  readonly created: boolean;
}

/** What opening a world needs besides its id or its form. */
export interface WorldDeps {
  readonly storage: Storage;
  readonly deflater: Deflater;
  readonly registry: Registry;
  readonly source: ColumnSource;
  readonly maxInFlight: number;
  readonly allowDebug: boolean;
  readonly worldType: WorldType;
  readonly viewRadius: number;
}

/**
 * An opening that failed, with the i18n key of the message the menu shows: another tab has the
 * world, it is gone, it was saved by a newer game or it cannot be read.
 */
export class WorldOpenError extends Error {
  readonly key: string;
  constructor(key: string, cause?: unknown) {
    super(key, { cause });
    this.name = 'WorldOpenError';
    this.key = key;
  }
}

/** The message key of an opening error (or of a failed import: `fallback`). */
export function openErrorKey(error: unknown, fallback = 'error.world.corrupt'): string {
  if (error instanceof WorldOpenError) return error.key;
  if (error instanceof SaveVersionError) return 'error.world.newer';
  return fallback;
}

/** The world's name: trimmed, at most WORLD_NAME_MAX characters, `fallback` when empty. */
export function worldName(name: string, fallback: string): string {
  return name.trim().slice(0, WORLD_NAME_MAX) || fallback;
}

/** Worlds by last save, most recent first (the first one is « Continue »). */
export function byLastPlayed(worlds: readonly WorldRecord[]): WorldRecord[] {
  return [...worlds].sort((a, b) => b.savedAt - a.savedAt || a.id.localeCompare(b.id));
}

/** File name of a world export: the name as letters, digits and dashes. */
export function exportFileName(name: string): string {
  const slug = name
    .normalize('NFKD')
    // Accents split off by NFKD go (é → e), then every other run becomes one dash.
    .replace(/\p{M}+/gu, '')
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${slug || 'world'}.cyw.gz`;
}

/** A fresh world id (also given to imported worlds). */
export function newWorldId(): string {
  // randomUUID needs a secure context (not a plain-http address on the local network).
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}

/** A random seed for a world whose seed field was left empty. */
export function randomSeed(): string {
  return Math.floor(Math.random() * 1e9).toString(36);
}

/** A new world as created: the form with its blanks filled, an id and the creation time. */
export interface NewWorld {
  readonly id: string;
  readonly name: string;
  readonly seed: string;
  readonly hostiles: boolean;
  /** Milliseconds since 1970. */
  readonly now: number;
}

/** The world a New world form makes: name trimmed (else `defaultName`), seed or a random one. */
export function newWorld(form: NewWorldForm, defaultName: string, now: number): NewWorld {
  return {
    id: newWorldId(),
    name: worldName(form.name, defaultName),
    seed: form.seed.trim() || randomSeed(),
    hostiles: form.hostiles,
    now,
  };
}

/**
 * Deletes a stored world unless a tab has it open (it would save it back): false then. The lock is
 * held while the records go.
 */
export async function deleteClosedWorld(storage: Storage, id: string): Promise<boolean> {
  const lock = await lockWorld(id);
  if (!lock) return false;
  try {
    await storage.deleteWorld(id);
    return true;
  } finally {
    await lock.release();
  }
}

/** A new world, locked: its simulation with the local player at the spawn. */
export async function createWorld(deps: WorldDeps, world: NewWorld): Promise<WorldSlot> {
  const lock = await lockWorld(world.id);
  if (!lock) throw new WorldOpenError('error.world.locked');
  const sim = new Simulation({
    seed: world.seed,
    worldType: deps.worldType,
    registry: deps.registry,
    source: deps.source,
    maxInFlight: deps.maxInFlight,
    allowDebug: deps.allowDebug,
  });
  sim.addPlayer(PLAYER_ID, deps.viewRadius);
  const info: WorldInfo = {
    id: world.id,
    name: world.name,
    createdAt: world.now,
    savedAt: world.now,
    rules: { hostiles: world.hostiles },
  };
  return { info, sim, lock, stored: new Map(), full: true, created: true };
}

/** A saved world, locked and restored; throws WorldOpenError (the lock is let go then). */
export async function loadWorld(deps: WorldDeps, id: string): Promise<WorldSlot> {
  const lock = await lockWorld(id);
  if (!lock) throw new WorldOpenError('error.world.locked');
  try {
    const options = {
      registry: deps.registry,
      source: deps.source,
      maxInFlight: deps.maxInFlight,
      allowDebug: deps.allowDebug,
    };
    const restored = await restoreSim(deps.storage, id, options, deps.deflater);
    if (!restored) throw new WorldOpenError('error.world.missing');
    // A save without a readable player record puts the player back at the spawn.
    restored.sim.addPlayer(PLAYER_ID, deps.viewRadius);
    return {
      info: restored.info,
      sim: restored.sim,
      lock,
      stored: restored.stored,
      full: restored.contentChanged,
      created: false,
    };
  } catch (error) {
    await lock.release();
    throw new WorldOpenError(openErrorKey(error), error);
  }
}
