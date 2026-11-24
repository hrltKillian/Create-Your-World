import { createLogger } from '../core/log.ts';
import { MemoryStorage } from '../sim/MemoryStorage.ts';
import type { SaveBatch, Storage, StoredWorld, WorldRecord } from '../sim/storage.ts';
import type { Deflater } from '../world/codec/columnRecord.ts';
import {
  byteTransfers,
  type IoCall,
  type IoReply,
  type IoRequest,
  payloads,
  type StoreCounts,
} from '../world/ioProtocol.ts';

const log = createLogger('storage');

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

/**
 * The saves in IndexedDB: main-thread proxy of io.worker, which owns the database and deflate-raw
 * (docs « Workers »). Requests carry an id; database answers come back in order, codec answers
 * (deflate, inflate) in order among themselves, never holding a write back. Written column
 * payloads are transferred to the worker: a batch is not read again once written.
 */
export class IdbStorage implements Storage, Deflater {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  /** Set once the worker is gone: every request fails with it. */
  private failure: Error | null = null;

  constructor() {
    this.worker = new Worker(new URL('../workers/io.worker.ts', import.meta.url), {
      type: 'module',
      name: 'io',
    });
    this.worker.onmessage = (event: MessageEvent<IoReply>) => this.settle(event.data);
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.fail(new Error(`io worker failed: ${event.message || 'could not load'}`));
    };
    this.worker.onmessageerror = () => this.fail(new Error('io worker sent an unreadable message'));
  }

  /** Opens the database: false when IndexedDB cannot be used (private browsing, blocked…). */
  async available(): Promise<boolean> {
    try {
      await this.call({ op: 'open' });
      return true;
    } catch (error) {
      log.warn('IndexedDB is unavailable', { error: String(error) });
      return false;
    }
  }

  listWorlds(): Promise<WorldRecord[]> {
    return this.call({ op: 'listWorlds' }) as Promise<WorldRecord[]>;
  }

  loadWorld(id: string): Promise<StoredWorld | undefined> {
    return this.call({ op: 'loadWorld', worldId: id }) as Promise<StoredWorld | undefined>;
  }

  async write(batch: SaveBatch): Promise<void> {
    await this.call({ op: 'write', batch }, byteTransfers(payloads(batch.columns)));
  }

  async deleteWorld(id: string): Promise<void> {
    await this.call({ op: 'deleteWorld', worldId: id });
  }

  inspect(id: string): Promise<StoreCounts> {
    return this.call({ op: 'inspect', worldId: id }) as Promise<StoreCounts>;
  }

  getKv(key: string): Promise<unknown> {
    return this.call({ op: 'getKv', key });
  }

  async setKv(key: string, value: unknown): Promise<void> {
    await this.call({ op: 'setKv', key, value });
  }

  /** Copies `raw` to the worker (compressPayload keeps it when deflate is not smaller). */
  deflate(raw: Uint8Array): Promise<Uint8Array> {
    return this.call({ op: 'deflate', bytes: raw }) as Promise<Uint8Array>;
  }

  inflate(packed: Uint8Array): Promise<Uint8Array> {
    return this.call({ op: 'inflate', bytes: packed }) as Promise<Uint8Array>;
  }

  dispose(): void {
    this.worker.terminate();
    this.fail(new Error('The io worker was disposed'));
  }

  private call(call: IoCall, transfer: ArrayBuffer[] = []): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...call, id } satisfies IoRequest, transfer);
    });
  }

  private settle(reply: IoReply): void {
    const pending = this.pending.get(reply.id);
    if (!pending) return;
    this.pending.delete(reply.id);
    if (reply.ok) pending.resolve(reply.value);
    else pending.reject(Object.assign(new Error(reply.message), { name: reply.name }));
  }

  private fail(error: Error): void {
    if (this.failure) return;
    log.error(error.message);
    this.failure = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

/** Where the saves go, and how column payloads are deflated. */
export interface SaveBackend {
  readonly storage: Storage;
  /** io.worker's deflate-raw (also behind the memory storage: imported worlds are deflated). */
  readonly deflater: Deflater;
  /** IndexedDB cannot be used: the saves only live in this page (« Saving unavailable » banner). */
  readonly unavailable: boolean;
}

/**
 * The save storage of the game: IndexedDB through io.worker; memory with `?storage=memory`
 * (deterministic boots), and as the fallback when IndexedDB cannot be used (`?forceNoIdb=1`).
 */
export async function openSaveBackend(params: {
  readonly storage: 'memory' | 'idb';
  readonly forceNoIdb: boolean;
}): Promise<SaveBackend> {
  const io = new IdbStorage();
  const idb = params.storage === 'idb';
  if (idb && !params.forceNoIdb && (await io.available()))
    return { storage: io, deflater: io, unavailable: false };
  return { storage: new MemoryStorage(), deflater: io, unavailable: idb };
}
