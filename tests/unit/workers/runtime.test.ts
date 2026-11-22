import { describe, expect, it } from 'vitest';
import { workerCount } from '../../../src/platform/WorkerPool.ts';
import { startWorldWorker } from '../../../src/workers/runtime.ts';
import type { HostMessage, WorkerMessage } from '../../../src/world/protocol.ts';

function harness() {
  const sent: { message: WorkerMessage; transfer: ArrayBuffer[] }[] = [];
  const scheduled: (() => void)[] = [];
  let deliver: ((message: HostMessage) => void) | null = null;
  startWorldWorker(
    {
      post: (message, transfer = []) => sent.push({ message, transfer }),
      listen: (handler) => (deliver = handler),
    },
    { schedule: (run) => scheduled.push(run) },
  );
  const flush = () => {
    while (scheduled.length > 0) scheduled.shift()!();
  };
  return { sent, send: (m: HostMessage) => deliver!(m), flush };
}

describe('world worker runtime', () => {
  it('answers init and ping through the injected port', () => {
    const { sent, send } = harness();
    send({ type: 'init', workerIndex: 2 });
    send({ type: 'ping', id: 9 });
    expect(sent.map((s) => s.message)).toEqual([
      { type: 'ready', workerIndex: 2 },
      { type: 'pong', id: 9, workerIndex: 2 },
    ]);
  });

  it('runs urgent jobs before normal ones that arrived earlier', () => {
    const { sent, send, flush } = harness();
    send({
      type: 'job',
      id: 1,
      priority: 'normal',
      job: { kind: 'gen', worldType: 'default', seed: 'q', cx: 0, cz: 0 },
    });
    send({
      type: 'job',
      id: 2,
      priority: 'urgent',
      job: { kind: 'gen', worldType: 'default', seed: 'q', cx: 1, cz: 0 },
    });
    flush();
    const ids = sent
      .filter((s) => s.message.type === 'result')
      .map((s) => (s.message as { id: number }).id);
    expect(ids).toEqual([2, 1]);
  });

  it('transfers generated arrays instead of copying them', () => {
    const { sent, send, flush } = harness();
    send({
      type: 'job',
      id: 7,
      priority: 'normal',
      job: { kind: 'gen', worldType: 'default', seed: 't', cx: 3, cz: -2 },
    });
    flush();
    const reply = sent.find((s) => s.message.type === 'result')!;
    expect(reply.transfer.length).toBeGreaterThanOrEqual(2);
    expect(reply.transfer.every((b) => b instanceof ArrayBuffer)).toBe(true);
  });

  it('reports job errors with the job id', () => {
    const { sent, send, flush } = harness();
    // A mesh job without arrays makes the handler throw.
    send({ type: 'job', id: 4, priority: 'normal', job: { kind: 'mesh' } as never });
    flush();
    expect(sent.at(-1)?.message).toMatchObject({ type: 'error', id: 4 });
  });

  it('sizes the pool from hardwareConcurrency', () => {
    expect(workerCount(10)).toBe(4);
    expect(workerCount(4)).toBe(2);
    expect(workerCount(2)).toBe(1);
    expect(workerCount(0)).toBe(2);
  });
});
