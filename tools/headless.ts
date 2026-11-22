/**
 * Headless runner (plain Node, no build): `npm run headless -- --ping`.
 * Later milestones add `--seed`, `--ticks` and `--bot` to run the simulation without a browser.
 */
import { parseArgs } from 'node:util';
import { startWorldWorker } from '../src/workers/runtime.ts';
import type { HostMessage, WorkerMessage } from '../src/world/protocol.ts';

const argv = process.argv.slice(2);
if (argv[0] === '--') argv.shift();

const { values } = parseArgs({
  args: argv,
  strict: true,
  options: {
    ping: { type: 'boolean', default: false },
  },
});

if (values.ping) {
  const replies: WorkerMessage[] = [];
  let deliver: ((message: HostMessage) => void) | null = null;
  startWorldWorker({ post: (m) => replies.push(m), listen: (handler) => (deliver = handler) });
  deliver!({ type: 'init', workerIndex: 0 });
  deliver!({ type: 'ping', id: 1 });
  const pong = replies.find((m) => m.type === 'pong');
  console.log(
    JSON.stringify({ ok: pong !== undefined, ping: pong ? 'pong' : null, node: process.version }),
  );
  process.exit(pong ? 0 : 1);
}

console.log(JSON.stringify({ ok: true, usage: 'npm run headless -- --ping' }));
