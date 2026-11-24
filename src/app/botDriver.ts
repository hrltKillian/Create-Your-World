import { TICKS_PER_SECOND } from '../sim/clock.ts';
import type { Command } from '../sim/commands.ts';
import type { SimEvent } from '../sim/events.ts';
import { BOT_KINDS, type BotKind, createBot } from '../sim/testing/bots.ts';
import { type BotTally, emptyTally, sendBotCommands, tallyEvent } from '../sim/testing/runBot.ts';
import type { App } from './App.ts';
import { frameOrFail, yieldTask } from './automation.ts';
import type { GameSession } from './GameSession.ts';

/**
 * The browser bot driver (M11 « un bot wanderMineBuild tourne 5 min dans le navigateur ») for the
 * debug hook and the selftests: a bot of sim/testing plays the open world's player, its commands
 * sent to the host on each of the session's ticks in place of the keyboard and mouse, the camera
 * looking where it looks.
 */

/** Ticks a fixed-step run advances per rendered frame (the world streams and meshes between). */
const FRAME_TICKS = 8;

/** A bot playing a session until `stop()`: what its player did meanwhile. */
export interface Piloting {
  readonly tally: Readonly<BotTally>;
  stop(): void;
}

/** Hands a session's player to a bot of `kind` (its random stream from `seed`) until `stop()`. */
export function pilot(session: GameSession, kind: BotKind, seed: string): Piloting {
  const player = session.player;
  const bot = createBot(kind, seed, session.host.view);
  const commands: Command[] = [];
  const tally = emptyTally();
  const listen = (event: SimEvent) => tallyEvent(tally, event, player.playerId);
  session.listeners.push(listen);
  session.pilot = (host) => {
    // The camera looks where the bot looked on the last tick.
    session.rig.yaw = player.yaw;
    session.rig.pitch = player.pitch;
    sendBotCommands(host, bot, player, commands);
  };
  return {
    tally,
    stop() {
      session.pilot = null;
      const i = session.listeners.indexOf(listen);
      if (i >= 0) session.listeners.splice(i, 1);
    },
  };
}

/** What a browser bot run did, and the errors captured during it. */
export interface BotDriveReport extends BotTally {
  readonly kind: BotKind;
  readonly ticks: number;
  readonly alive: boolean;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly errors: readonly string[];
}

/**
 * Lets a bot play the open world for `seconds` of game time (the world seed drives its choices).
 * With fixed steps the driver advances the ticks itself, FRAME_TICKS per frame; otherwise the frame
 * loop ticks in real time (and a hidden page ticks between tasks, as waitForChunks does). Fails when
 * the ticks fall far behind (the world paused or closed).
 */
export async function driveBot(
  app: App,
  kind: BotKind = 'wanderMineBuild',
  seconds = 300,
): Promise<BotDriveReport> {
  const session = app.session;
  if (!session || app.params.freecam) throw new Error('A bot needs a player session');
  if (!BOT_KINDS.includes(kind)) throw new Error(`No bot ${kind} (${BOT_KINDS.join(', ')})`);
  const view = session.host.view;
  const errors = app.errors.length;
  const start = view.tick();
  const end = start + Math.round(seconds * TICKS_PER_SECOND);
  const deadline = performance.now() + seconds * 2000 + 10_000;
  const run = pilot(session, kind, session.seed);
  try {
    while (view.tick() < end) {
      if (app.params.fixedStep) session.step(Math.min(FRAME_TICKS, end - view.tick()));
      else if (document.hidden) session.pumpOnce(true);
      await (document.hidden ? yieldTask() : frameOrFail());
      if (performance.now() > deadline)
        throw new Error(
          `Bot ${kind}: ${view.tick() - start} of ${end - start} ticks (${app.state})`,
        );
    }
  } finally {
    run.stop();
  }
  const { survival, body } = session.player;
  return {
    kind,
    ticks: view.tick() - start,
    ...run.tally,
    alive: !survival.dead,
    x: body.x,
    y: body.y,
    z: body.z,
    errors: app.errors.slice(errors),
  };
}
