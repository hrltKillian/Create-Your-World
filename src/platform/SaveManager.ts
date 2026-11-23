import { createLogger } from '../core/log.ts';
import type { SimEvent } from '../sim/events.ts';
import {
  compressBatch,
  dropDigest,
  type StoredColumns,
  snapshotSim,
  type WorldInfo,
} from '../sim/persistence.ts';
import type { Simulation } from '../sim/Simulation.ts';
import type { SaveBatch, Storage } from '../sim/storage.ts';
import type { Deflater } from '../world/codec/columnRecord.ts';
import { blockToColumn, columnKey } from '../world/coords.ts';

const log = createLogger('save');

/** Autosave period (docs « Sauvegarde automatique »). */
export const AUTOSAVE_MS = 30_000;
/** First retry after a failed save (other than a full disk); the delay doubles up to MAX_RETRY_MS. */
export const RETRY_MS = 2_000;
export const MAX_RETRY_MS = 60_000;

/** 'quota': the disk is full; the world stays in memory and the UI shows a notification. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'quota' | 'error';

export interface SaveManagerOptions {
  readonly storage: Storage;
  readonly deflater: Deflater;
  readonly sim: Simulation;
  /** The world's name, dates and rules (each save sets `savedAt`). */
  readonly info: WorldInfo;
  /** The column records already in storage (a restored world's `stored`). */
  readonly stored?: StoredColumns;
  /**
   * The first save writes every column (default): a new world, or a world saved with another pack
   * (`RestoredWorld.contentChanged`). False for a world restored as it was saved.
   */
  readonly full?: boolean;
  /** Wall clock (ms since 1970) for `savedAt`. */
  readonly now?: () => number;
  readonly onStatus?: (status: SaveStatus) => void;
}

/** The page events a save listens to (document and window in the game, fakes in tests). */
export interface PageTargets {
  readonly doc: EventTarget & { readonly visibilityState: DocumentVisibilityState };
  readonly win: EventTarget;
}

/**
 * Saves one world (docs « Sauvegarde automatique »): every 30 s, on demand (pause, quit, a modified
 * column unloaded), and right away, raw, when the page hides or goes away.
 *
 * Edited columns carry versioned dirty flags, set from the simulation's events; a save snapshots
 * the dirty columns (plus those whose item drops differ from their stored record's), encodes
 * everything, then writes one transaction, and clears only the flags whose version did not change
 * meanwhile. A full disk keeps the flags (the world stays in memory) until the next autosave;
 * another error retries after a doubling delay. Saves run one at a time.
 */
export class SaveManager {
  status: SaveStatus = 'idle';
  private readonly storage: Storage;
  private readonly deflater: Deflater;
  private readonly sim: Simulation;
  private readonly info: WorldInfo;
  private readonly now: () => number;
  private readonly onStatus: (status: SaveStatus) => void;
  /**
   * The column records in storage, with the digest of their drops, as of the writes sent. A write
   * that fails marks its columns dirty and keeps the ones it was to remove (an extra key only costs
   * a useless delete).
   */
  private readonly stored: Map<number, string>;
  /** Column key → version of its last change. */
  private readonly dirty = new Map<number, number>();
  private version = 0;
  private full: boolean;
  /** Snapshots taken to be written; a save whose snapshot is no longer the last drops its write. */
  private snapshots = 0;
  /** The save running or queued last. */
  private last: Promise<boolean> = Promise.resolve(true);
  /** A save waiting for the running one: later requests share it. */
  private queued: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retryMs = RETRY_MS;
  private closed = false;
  /** The page events followed (`watchPage`), and how to stop following them. */
  private page: PageTargets | null = null;
  private unwatch: (() => void) | null = null;

  constructor(options: SaveManagerOptions) {
    this.storage = options.storage;
    this.deflater = options.deflater;
    this.sim = options.sim;
    this.info = options.info;
    this.stored = new Map(options.stored);
    this.full = options.full ?? true;
    this.now = options.now ?? Date.now;
    this.onStatus = options.onStatus ?? (() => {});
  }

  /** Starts the autosave clock. */
  start(): void {
    this.schedule(AUTOSAVE_MS);
  }

  /** Columns waiting for a save (tests, debug). */
  dirtyColumns(): number[] {
    return [...this.dirty.keys()];
  }

  /** Follows the simulation's events: edits make their columns dirty. */
  onEvent(event: SimEvent): void {
    if (event.type === 'blocksChanged') {
      const cz1 = blockToColumn(event.z1);
      const cx1 = blockToColumn(event.x1);
      for (let cz = blockToColumn(event.z0); cz <= cz1; cz++)
        for (let cx = blockToColumn(event.x0); cx <= cx1; cx++) this.mark(columnKey(cx, cz));
    } else if (event.type === 'columnUnloaded' && this.dirty.has(columnKey(event.cx, event.cz))) {
      void this.save();
    }
  }

  /** Saves after the running save, if any (pause, quit, autosave); resolves with its success. */
  save(): Promise<boolean> {
    if (this.queued) return this.queued;
    const next = this.last.then(() => {
      this.queued = null;
      return this.run();
    });
    this.queued = next;
    this.last = next;
    return next;
  }

  /**
   * The page hides or goes away: writes the changes now, raw, in one transaction sent before this
   * returns. Its columns are marked, so the next save writes them again, deflated.
   */
  flush(): void {
    if (this.closed) return;
    const batch = this.snapshot();
    this.snapshots++;
    this.sending(batch);
    for (const column of batch.columns) this.mark(columnKey(column.cx, column.cz));
    this.storage.write(batch).catch((error: unknown) => {
      log.warn('page-hide save failed', { error: String(error) });
      this.unsent(batch);
    });
  }

  /** Flushes when the page hides or goes away, until `stop` or `close`. */
  watchPage(page: PageTargets): void {
    this.unwatch?.();
    this.page = page;
    const onVisibility = () => {
      if (page.doc.visibilityState === 'hidden') this.flush();
    };
    const onPageHide = () => this.flush();
    page.doc.addEventListener('visibilitychange', onVisibility);
    page.win.addEventListener('pagehide', onPageHide);
    this.unwatch = () => {
      page.doc.removeEventListener('visibilitychange', onVisibility);
      page.win.removeEventListener('pagehide', onPageHide);
    };
  }

  /** No more saves: stops the autosave and the page watch (a save under way still ends). */
  stop(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.unwatch?.();
    this.unwatch = null;
  }

  /**
   * Save & quit: stops the autosave and the page watch, then saves a last time. When that save
   * fails, the world stays open: the autosave and the page watch start again.
   */
  async close(): Promise<boolean> {
    this.stop();
    const saved = await this.save();
    if (!saved) {
      this.closed = false;
      if (this.page) this.watchPage(this.page);
      this.start();
    }
    return saved;
  }

  private mark(key: number): void {
    this.dirty.set(key, ++this.version);
  }

  /** Raw records of the world, its players and the columns to write (every one when `full`). */
  private snapshot(): SaveBatch {
    const only = this.full ? undefined : new Set(this.dirty.keys());
    return snapshotSim(this.sim, { ...this.info, savedAt: this.now() }, this.stored, only);
  }

  private async run(): Promise<boolean> {
    const versions = new Map(this.dirty);
    const full = this.full;
    const batch = this.snapshot();
    const snapshot = ++this.snapshots;
    this.setStatus('saving');
    try {
      const packed = await compressBatch(batch, this.deflater);
      // Otherwise a page-hide flush wrote a newer snapshot meanwhile, which this one would undo;
      // its flags are still set.
      if (snapshot === this.snapshots) {
        this.sending(packed);
        await this.storage.write(packed).catch((error: unknown) => {
          this.unsent(packed);
          throw error;
        });
        for (const [key, v] of versions) if (this.dirty.get(key) === v) this.dirty.delete(key);
        if (full) this.full = false;
      }
      this.retryMs = RETRY_MS;
      this.setStatus('saved');
      this.schedule(AUTOSAVE_MS);
      return true;
    } catch (error) {
      log.warn('save failed', { error: String(error) });
      const quota = (error as { name?: unknown } | null)?.name === 'QuotaExceededError';
      this.setStatus(quota ? 'quota' : 'error');
      if (quota) this.schedule(AUTOSAVE_MS);
      else {
        this.schedule(this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
      }
      return false;
    }
  }

  /** A write is sent: its columns are (about to be) stored with their drops, the removed gone. */
  private sending(batch: SaveBatch): void {
    for (const column of batch.columns)
      this.stored.set(columnKey(column.cx, column.cz), dropDigest(column.entities));
    for (const { cx, cz } of batch.removed) this.stored.delete(columnKey(cx, cz));
  }

  /**
   * A write failed: storage may still hold the records it replaced, so its columns are written
   * again by the next save, and the ones it was to remove are still known.
   */
  private unsent(batch: SaveBatch): void {
    for (const column of batch.columns) this.mark(columnKey(column.cx, column.cz));
    for (const { cx, cz } of batch.removed) this.stored.set(columnKey(cx, cz), '');
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    if (!this.closed) this.timer = setTimeout(() => void this.save(), ms);
  }

  private setStatus(status: SaveStatus): void {
    this.status = status;
    this.onStatus(status);
  }
}

/** Asks the browser not to evict the saves under storage pressure (on world creation). */
export async function requestPersistence(
  manager: StorageManager | undefined = navigator.storage,
): Promise<boolean> {
  try {
    return (await manager?.persist()) ?? false;
  } catch {
    return false;
  }
}

/** Bytes the saves use and may use (shown in the menus), or null when unknown. */
export async function storageEstimate(
  manager: StorageManager | undefined = navigator.storage,
): Promise<{ usage: number; quota: number } | null> {
  try {
    const estimate = await manager?.estimate();
    return estimate ? { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 } : null;
  } catch {
    return null;
  }
}
