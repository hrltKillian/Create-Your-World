import type { Deflater } from '../world/codec/columnRecord.ts';
import {
  byteTransfers,
  type IoCall,
  type IoPort,
  type IoRequest,
  type IoWorldRecords,
  payloads,
} from '../world/ioProtocol.ts';
import { type IdbStore, openIdbStore } from './io/idbStore.ts';
import { streamDeflater } from './io/streamDeflater.ts';

export interface IoDeps {
  /** Opens the save database (called again after a failure). */
  readonly openStore: () => Promise<IdbStore>;
  readonly deflater: Deflater;
}

const BROWSER_DEPS: IoDeps = { openStore: () => openIdbStore(), deflater: streamDeflater };

/** Buffers of a reply to transfer: deflated or inflated bytes, column payloads of a loaded world. */
function replyTransfers(call: IoCall, value: unknown): ArrayBuffer[] {
  if (value instanceof Uint8Array) return byteTransfers([value]);
  if (call.op === 'loadWorld' && value)
    return byteTransfers(payloads((value as IoWorldRecords).columns));
  return [];
}

/**
 * The io worker (docs « Workers »: codec, deflate-raw and IndexedDB). Pure module: it only talks to
 * the injected port, so tests run it with fake-indexeddb. Requests run one at a time in arrival
 * order, so a read always sees the writes sent before it. The database opens on the first request
 * that needs it; when it cannot (no IndexedDB), each such request answers the error.
 */
export function startIoWorker(port: IoPort, deps: IoDeps = BROWSER_DEPS): void {
  let opening: Promise<IdbStore> | null = null;
  const store = (): Promise<IdbStore> =>
    (opening ??= deps.openStore().catch((error: unknown) => {
      opening = null;
      throw error;
    }));

  const run = async (call: IoCall): Promise<unknown> => {
    switch (call.op) {
      case 'open':
        await store();
        return true;
      case 'listWorlds':
        return (await store()).listWorlds();
      case 'loadWorld':
        return (await store()).loadWorld(call.worldId);
      case 'write':
        return (await store()).write(call.batch);
      case 'deleteWorld':
        return (await store()).deleteWorld(call.worldId);
      case 'inspect':
        return (await store()).inspect(call.worldId);
      case 'getKv':
        return (await store()).getKv(call.key);
      case 'setKv':
        return (await store()).setKv(call.key, call.value);
      case 'deflate':
        return deps.deflater.deflate(call.bytes);
      case 'inflate':
        return deps.deflater.inflate(call.bytes);
    }
  };

  let queue = Promise.resolve();
  port.listen((request: IoRequest) => {
    queue = queue.then(async () => {
      try {
        const value = await run(request);
        port.post({ id: request.id, ok: true, value }, replyTransfers(request, value));
      } catch (error) {
        // Duck-typed: IndexedDB rejects with DOMExceptions (QuotaExceededError, AbortError…).
        const { name, message } = (error ?? {}) as { name?: unknown; message?: unknown };
        port.post({
          id: request.id,
          ok: false,
          name: typeof name === 'string' ? name : 'Error',
          message: typeof message === 'string' ? message : String(error),
        });
      }
    });
  });
}
