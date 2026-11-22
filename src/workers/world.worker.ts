import type { HostMessage, WorkerMessage } from '../world/protocol.ts';
import { startWorldWorker } from './runtime.ts';

startWorldWorker({
  post: (message: WorkerMessage, transfer: ArrayBuffer[] = []) =>
    self.postMessage(message, transfer),
  listen: (handler) => {
    self.onmessage = (event: MessageEvent<HostMessage>) => handler(event.data);
  },
});
