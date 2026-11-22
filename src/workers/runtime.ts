import type { HostMessage, WorkerPort } from '../world/protocol.ts';

/**
 * Worker-side runtime. Pure module: it only talks to the injected port, so it runs the same
 * way inside a Web Worker, in Node (tools/headless.ts) and in unit tests.
 */
export function startWorldWorker(port: WorkerPort): void {
  let workerIndex = -1;
  port.listen((message: HostMessage) => {
    try {
      switch (message.type) {
        case 'init':
          workerIndex = message.workerIndex;
          port.post({ type: 'ready', workerIndex });
          break;
        case 'ping':
          port.post({ type: 'pong', id: message.id, workerIndex });
          break;
      }
    } catch (error) {
      const id = 'id' in message ? message.id : -1;
      port.post({
        type: 'error',
        id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
