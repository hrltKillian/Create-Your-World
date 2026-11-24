import { describe, expect, it } from 'vitest';
import { pilot } from '../../../src/app/botDriver.ts';
import { GameSession } from '../../../src/app/GameSession.ts';
import type { InputManager } from '../../../src/input/InputManager.ts';
import type { LookTarget } from '../../../src/input/LookTarget.ts';
import type { WorkerPool } from '../../../src/platform/WorkerPool.ts';
import { type Command, type InputCommand, NEUTRAL_INPUT } from '../../../src/sim/commands.ts';
import { InlineColumnSource } from '../../../src/sim/InlineColumnSource.ts';
import { createLocalServer } from '../../../src/sim/localServer.ts';
import { createBot } from '../../../src/sim/testing/bots.ts';
import { registry } from '../../helpers/registry.ts';
import { createTestWorldView } from '../../helpers/worldView.ts';

/** The keyboard and mouse: primary held on slot 2 (a stand-in for the InputManager, no DOM). */
const input = {
  slot: 2,
  applyMouseLook: () => {},
  consume: () => false,
  isDown: () => false,
  shiftHeld: () => false,
  tickForced: () => {},
  sample: (look: LookTarget): InputCommand => ({
    ...NEUTRAL_INPUT,
    yaw: look.yaw,
    pitch: look.pitch,
    primary: true,
    slot: 2,
  }),
};
/** Meshing never answers: the session only needs its ticks. */
const pool = { size: 1, run: () => new Promise(() => {}) };

/** A session on a flat world generated inline, recording every command sent to its host. */
function createSession() {
  const host = createLocalServer({
    seed: 'pilot',
    worldType: 'flat',
    registry,
    source: new InlineColumnSource(registry),
    maxInFlight: 8,
    allowDebug: true,
    playerId: 1,
    viewRadius: 2,
  });
  const sent: Command[] = [];
  const send = host.send.bind(host);
  host.send = (command) => {
    sent.push(command);
    send(command);
  };
  const session = new GameSession(
    { renderDistance: 2, freecam: null, fixedStep: true },
    host,
    pool as unknown as WorkerPool,
    createTestWorldView().view,
    input as unknown as InputManager,
  );
  return { session, sent };
}

describe('the browser bot driver', () => {
  it("sends a bot's commands on each tick in place of the keyboard's, until stopped", () => {
    const { session, sent } = createSession();
    session.step(30);
    const listeners = session.listeners.length;
    const keys = { slot: 2 };
    const run = pilot(session, 'wanderMineBuild', 'pilot', keys);
    // A twin bot fed the same player state at the same moments sends the same commands.
    const twin = createBot('wanderMineBuild', 'pilot', session.host.view);
    const expected: Command[] = [];
    for (let i = 0; i < 300; i++) {
      expected.length = 0;
      twin.next(session.player, session.host.view.tick(), expected);
      sent.length = 0;
      session.step(1);
      expect(sent.filter((c) => c.type !== 'client.view')).toEqual(expected);
    }
    // The camera and the hotbar follow the bot's input of the tick before.
    const { yaw, slot } = session.player.input;
    session.step(1);
    expect(session.rig.yaw).toBe(yaw);
    expect(keys.slot).toBe(slot);
    run.stop();
    expect(session.listeners).toHaveLength(listeners);
    session.step(1);
    expect(session.player.input).toMatchObject({ primary: true, slot: 2 });
  });

  it("counts its player's death and the respawn it asks for", () => {
    const { session } = createSession();
    session.step(30);
    const run = pilot(session, 'wanderMineBuild', 'pilot');
    session.host.send({ type: 'debug.kill', cause: 'fall' });
    session.step(3);
    expect(run.tally).toMatchObject({ deaths: 1, respawns: 1 });
    expect(session.player.survival.dead).toBe(false);
    run.stop();
  });
});
