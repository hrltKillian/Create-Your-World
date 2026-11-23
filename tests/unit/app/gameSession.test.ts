import { describe, expect, it } from 'vitest';
import { GameSession } from '../../../src/app/GameSession.ts';
import type { InputManager } from '../../../src/input/InputManager.ts';
import type { LookTarget } from '../../../src/input/LookTarget.ts';
import type { WorkerPool } from '../../../src/platform/WorkerPool.ts';
import { type InputCommand, NEUTRAL_INPUT } from '../../../src/sim/commands.ts';
import { createLocalServer } from '../../../src/sim/localServer.ts';
import type { ColumnSource } from '../../../src/sim/ports.ts';
import { registry } from '../../helpers/registry.ts';
import { createTestWorldView } from '../../helpers/worldView.ts';

/** Input that holds primary on slot 2 (a stand-in for the InputManager, no DOM). */
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
/** Columns never arrive: the session keeps loading, which is enough to apply commands. */
const pool = { size: 1, run: () => new Promise(() => {}) };
const source: ColumnSource = { connect: () => {}, request: () => {} };

function createSession(view = createTestWorldView().view): GameSession {
  const host = createLocalServer({
    seed: 'pause',
    worldType: 'flat',
    registry,
    source,
    maxInFlight: 2,
    playerId: 1,
    viewRadius: 2,
  });
  return new GameSession(
    { renderDistance: 2, freecam: null, fixedStep: false },
    host,
    pool as unknown as WorkerPool,
    view,
    input as unknown as InputManager,
  );
}

describe('GameSession', () => {
  it('releases the held buttons when it pauses, keeping the view and the slot, without a tick', () => {
    const session = createSession();
    session.rig.yaw = 1.25;
    session.rig.pitch = -0.4;
    session.step(1);
    expect(session.player.input.primary).toBe(true);
    const tick = session.host.view.tick();
    session.setPaused(true);
    session.frame(1);
    const held = session.player.input;
    expect(held.primary).toBe(false);
    expect([held.yaw, held.pitch, held.slot]).toEqual([1.25, -0.4, 2]);
    expect(session.host.view.tick()).toBe(tick);
  });

  it('leaves the shared world view when the world closes', () => {
    const { view } = createTestWorldView();
    const before = view.scene.children.length;
    const session = createSession(view);
    expect(view.scene.children.length).toBeGreaterThan(before);
    session.dispose();
    expect(view.scene.children.length).toBe(before);
  });
});
