import { describe, expect, it } from 'vitest';
import { workerCount } from '../../../src/platform/WorkerPool.ts';
import { startWorldWorker } from '../../../src/workers/runtime.ts';
import type { HostMessage, WorkerMessage } from '../../../src/world/protocol.ts';

describe('world worker runtime', () => {
  it('answers init and ping through the injected port', () => {
    const sent: WorkerMessage[] = [];
    let deliver: ((message: HostMessage) => void) | null = null;
    startWorldWorker({ post: (m) => sent.push(m), listen: (handler) => (deliver = handler) });
    deliver!({ type: 'init', workerIndex: 2 });
    deliver!({ type: 'ping', id: 9 });
    expect(sent).toEqual([
      { type: 'ready', workerIndex: 2 },
      { type: 'pong', id: 9, workerIndex: 2 },
    ]);
  });

  it('sizes the pool from hardwareConcurrency', () => {
    expect(workerCount(10)).toBe(4);
    expect(workerCount(4)).toBe(2);
    expect(workerCount(2)).toBe(1);
    expect(workerCount(0)).toBe(2);
  });
});
