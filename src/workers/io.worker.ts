import type { IoReply, IoRequest } from '../world/ioProtocol.ts';
import { startIoWorker } from './ioJobs.ts';

startIoWorker({
  post: (message: IoReply, transfer: ArrayBuffer[] = []) => self.postMessage(message, transfer),
  listen: (handler) => {
    self.onmessage = (event: MessageEvent<IoRequest>) => handler(event.data);
  },
});
