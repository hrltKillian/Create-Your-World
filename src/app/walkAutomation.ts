import { anglesTo } from '../core/angles.ts';
import { type WalkOptions, type WalkPort, walkObjectives } from '../sim/testing/objectiveWalk.ts';
import type { App } from './App.ts';
import { frameOrFail, look, press, sendAndStep, teleport, waitForChunks } from './automation.ts';

/**
 * The objectives walk (sim/testing/objectiveWalk.ts) in the browser (M11): its port over the play
 * session, driven by the automation helpers the debug hook and the selftests share (commands
 * applied with a tick, fixed steps, the view turned and a button or a key held as the player would,
 * teleports that wait for the meshed world). selftest/objectivesWalk.ts runs it.
 */

/** Ticks a teleported player gets to land and settle. */
const SETTLE_TICKS = 5;
/** Longest wait for the loading radius around a journey's end to be meshed. */
const TRAVEL_MS = 30_000;

/** The walk's port over the open world's session (fixed steps: a command applies at once). */
export function walkPort(app: App): WalkPort {
  const session = app.session!;
  return {
    view: session.host.view,
    send: (command) => sendAndStep(app, command),
    step: (ticks) => session.step(ticks),
    hold: async (action, slot, at, ticks, until) => {
      app.input!.slot = slot;
      // The eye follows the body on frames: place it, turn the view, then let the aim follow.
      await frameOrFail();
      const { yaw, pitch } = anglesTo(session.rig.eye, at);
      look(app, yaw, pitch);
      await frameOrFail();
      // One tick at a time: the action stays held from one press to the next.
      for (let i = 0; i < ticks && !until?.(); i++) press(app, action, 1);
      session.step(1);
    },
    travel: async (x, y, z) => {
      teleport(app, x, y, z);
      await waitForChunks(app, session.loadingRadius(), TRAVEL_MS);
      await frameOrFail();
      session.step(SETTLE_TICKS);
    },
  };
}

/**
 * Walks the pack's objectives from where the player stands, in chain order (a player who has done
 * none, fixed steps; biomes searched within `searchRadius` of home); resolves with the keys done.
 */
export function walkObjectivesHere(
  app: App,
  searchRadius: number,
  onDone?: WalkOptions['onDone'],
): Promise<string[]> {
  if (!app.session || !app.input || app.params.freecam)
    return Promise.reject(new Error('the walk needs a player (no ?freecam)'));
  if (!app.params.fixedStep) return Promise.reject(new Error('the walk needs ?fixedStep=1'));
  return walkObjectives(walkPort(app), { searchRadius, onDone });
}
