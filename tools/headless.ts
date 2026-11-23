/**
 * Headless runner (plain Node, no build).
 *   npm run headless -- --ping
 *   npm run headless -- --seed=42 --ticks=3000 --bot=wander [--world=flat|arena] [--rd=2] [--serialize]
 * Prints one JSON line: {hash, tps, columns, ...}.
 */
import { parseArgs } from 'node:util';
import { basePack } from '../src/content/packs/base/index.ts';
import { buildRegistry } from '../src/content/registry.ts';
import { BOT_KINDS, type BotKind } from '../src/sim/testing/bots.ts';
import { runBot } from '../src/sim/testing/runBot.ts';
import { startWorldWorker } from '../src/workers/runtime.ts';
import type { WorldType } from '../src/world/gen/generateColumn.ts';
import type { HostMessage, WorkerMessage } from '../src/world/protocol.ts';

const argv = process.argv.slice(2);
if (argv[0] === '--') argv.shift();

const { values } = parseArgs({
  args: argv,
  strict: true,
  options: {
    ping: { type: 'boolean', default: false },
    seed: { type: 'string' },
    ticks: { type: 'string', default: '3000' },
    bot: { type: 'string', default: 'wander' },
    world: { type: 'string', default: 'default' },
    rd: { type: 'string', default: '2' },
    serialize: { type: 'boolean', default: false },
  },
});

function fail(message: string): never {
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

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

if (values.seed !== undefined) {
  const ticks = Number(values.ticks);
  const rd = Number(values.rd);
  if (!Number.isInteger(ticks) || ticks < 0) fail(`--ticks must be a whole number`);
  if (!Number.isInteger(rd) || rd < 1 || rd > 10) fail(`--rd must be 1–10`);
  if (!BOT_KINDS.includes(values.bot as BotKind)) fail(`--bot must be one of ${BOT_KINDS}`);
  if (!['default', 'flat', 'arena'].includes(values.world))
    fail(`--world must be default|flat|arena`);
  const registry = buildRegistry(basePack);
  const t0 = performance.now();
  const result = runBot({
    registry,
    seed: values.seed,
    ticks,
    bot: values.bot as BotKind,
    worldType: values.world as WorldType,
    viewRadius: rd,
    serialize: values.serialize,
  });
  const seconds = (performance.now() - t0) / 1000;
  console.log(
    JSON.stringify({
      ok: true,
      seed: values.seed,
      bot: values.bot,
      ticks: result.ticks,
      hash: result.hash,
      tps: Math.round(result.ticks / Math.max(seconds, 1e-6)),
      columns: result.columns,
      pos: [result.x, result.y, result.z].map((v) => Math.round(v * 100) / 100),
    }),
  );
  process.exit(0);
}

console.log(
  JSON.stringify({
    ok: true,
    usage:
      'npm run headless -- --ping | --seed=42 --ticks=3000 --bot=wander [--world=flat] [--rd=2]',
  }),
);
