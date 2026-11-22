import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerPool } from '../../../src/platform/WorkerPool.ts';
import { startWorldWorker } from '../../../src/workers/runtime.ts';
import type { HostMessage, WorkerMessage } from '../../../src/world/protocol.ts';

/** In-process stand-in for a module Worker running the real runtime. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  static hang = false;
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  received: HostMessage[] = [];
  private deliver: ((m: HostMessage) => void) | null = null;

  constructor() {
    FakeWorker.instances.push(this);
    startWorldWorker(
      {
        post: (message) =>
          queueMicrotask(() => this.onmessage?.({ data: message } as MessageEvent<WorkerMessage>)),
        listen: (handler) => (this.deliver = handler),
      },
      { schedule: (run) => queueMicrotask(run) },
    );
  }

  postMessage(message: HostMessage): void {
    this.received.push(message);
    if (!FakeWorker.hang || message.type === 'init') this.deliver?.(message);
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('worker pool', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    FakeWorker.instances = [];
    FakeWorker.hang = false;
  });

  it('runs generation jobs and keeps at most 2 normal jobs in flight per worker', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const pool = new WorkerPool(2);
    const jobs = Array.from({ length: 7 }, (_, i) =>
      pool.run({ kind: 'gen', worldType: 'default', seed: 'p', cx: i, cz: 0 }),
    );
    expect(pool.stats().inFlight).toBe(4);
    expect(pool.stats().queued).toBe(3);
    const results = await Promise.all(jobs);
    expect(results.map((r) => r.cx)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(pool.stats().done.gen).toBe(7);
    await expect(pool.ping()).resolves.toBe('pong');
  });

  it('sends urgent jobs even when every worker is busy', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const pool = new WorkerPool(1);
    for (let i = 0; i < 3; i++)
      void pool.run({ kind: 'gen', worldType: 'default', seed: 'u', cx: i, cz: 0 });
    void pool.run({ kind: 'gen', worldType: 'default', seed: 'u', cx: 9, cz: 9 }, 'urgent');
    const sent = FakeWorker.instances[0]!.received.filter((m) => m.type === 'job');
    expect(sent).toHaveLength(3); // 2 normal + 1 urgent; the third normal waits
  });

  it('restarts a worker that stops answering and fails its jobs', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
    FakeWorker.hang = true;
    const pool = new WorkerPool(1);
    const job = pool.run({ kind: 'gen', worldType: 'default', seed: 'h', cx: 0, cz: 0 });
    const failed = expect(job).rejects.toThrow(/did not answer/);
    await vi.advanceTimersByTimeAsync(10_001);
    await failed;
    expect(FakeWorker.instances[0]!.terminated).toBe(true);
    // Respawned after a short back-off.
    await vi.advanceTimersByTimeAsync(300);
    expect(FakeWorker.instances).toHaveLength(2);
    expect(pool.stats().restarts).toBe(1);
  });

  it('gives a slot up after 3 consecutive failures and reports a fatal error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
    FakeWorker.hang = true;
    const pool = new WorkerPool(1);
    let fatal = '';
    pool.onFatal = (reason) => {
      fatal = reason;
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      const job = pool.run({ kind: 'gen', worldType: 'default', seed: 'f', cx: attempt, cz: 0 });
      const failed = expect(job).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(10_001);
      await failed;
      await vi.advanceTimersByTimeAsync(2_000);
    }
    expect(fatal).toMatch(/stopped working/);
    await expect(
      pool.run({ kind: 'gen', worldType: 'default', seed: 'f', cx: 9, cz: 9 }),
    ).rejects.toThrow(/stopped working/);
  });
});
