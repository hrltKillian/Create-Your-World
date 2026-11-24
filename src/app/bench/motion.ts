import { TICKS_PER_SECOND } from '../../sim/clock.ts';
import type { App } from '../App.ts';
import { look } from '../automation.ts';
import { sampleFrames } from './sampler.ts';
import { staged, teleportAndWait } from './stage.ts';

/** The motion benchmarks: the free camera flown straight (`fly`), the player walking (`walk`). */

export const FLY = {
  seconds: 10,
  /** Blocks per second, eastwards, at least this high (over the trees and hills). */
  speed: 20,
  minY: 110,
  pitch: -0.2,
} as const;

/**
 * Flies the free camera east in a straight line for `seconds` (the pane must be visible), with
 * the world streaming ahead of it; puts the camera back after.
 */
export async function flyBenchmark(app: App, seconds: number = FLY.seconds) {
  const cam = app.freecam;
  if (!cam) throw new Error('fly needs the free camera (?freecam=1)');
  const start = { ...cam.pose };
  try {
    cam.set({ y: Math.max(start.y, FLY.minY), pitch: FLY.pitch, yaw: -Math.PI / 2 });
    const frames = await sampleFrames(app, seconds, (t) => cam.set({ x: start.x + t * FLY.speed }));
    return { kind: 'fly' as const, seconds, ...frames };
  } finally {
    cam.set(start);
  }
}

export const WALK = {
  seconds: 20,
  /** Noon, frozen: daylight, and no hostile spawns on the way. */
  hour: 12,
  /** A little under the horizon, as a walking player looks. */
  pitch: -0.1,
  /** Under this horizontal speed (m/s) on the ground the player is blocked: it jumps. */
  blockedSpeed: 0.5,
  /** Every `checkEvery` s, a walk of less than `minProgress` blocks turns a quarter to the right. */
  checkEvery: 1.5,
  minProgress: 1,
} as const;

/**
 * The player walks for `seconds` of real ticks (the pane must be visible) from where it stands,
 * jumping onto steps (jump held for 2 ticks while blocked on the ground) and turning away
 * from walls, with the world streaming around it; immune, at noon. Frame statistics, and the blocks
 * walked. The player, the clock and its immunity are put back after.
 */
export async function walkBenchmark(app: App, seconds: number = WALK.seconds) {
  const session = app.session;
  const input = app.input;
  if (!session || !input || app.freecam) throw new Error('walk needs a player');
  if (app.params.fixedStep) throw new Error('walk needs real ticks (no ?fixedStep)');
  const body = session.player.body;
  const start = { x: body.x, y: body.y, z: body.z };
  let yaw = session.rig.yaw;
  let distance = 0;
  let lastX = body.x;
  let lastZ = body.z;
  let checkAt = 0;
  let checkX = body.x;
  let checkZ = body.z;
  const step = (t: number) => {
    distance += Math.hypot(body.x - lastX, body.z - lastZ);
    lastX = body.x;
    lastZ = body.z;
    if (t - checkAt >= WALK.checkEvery) {
      if (Math.hypot(body.x - checkX, body.z - checkZ) < WALK.minProgress) yaw -= Math.PI / 2;
      checkAt = t;
      checkX = body.x;
      checkZ = body.z;
    }
    look(app, yaw, WALK.pitch);
    // Up a step (released in the air: a held jump would jump again on landing), or swimming up.
    const blocked = body.onGround && Math.hypot(body.vx, body.vz) < WALK.blockedSpeed;
    if (blocked || body.inWater) input.force('jump', 2);
  };
  const frames = await staged(app, WALK.hour, async () => {
    try {
      input.force('forward', Math.ceil((seconds + 1) * TICKS_PER_SECOND));
      return await sampleFrames(app, seconds, step);
    } finally {
      input.force('forward', 0);
      input.force('jump', 0);
      await teleportAndWait(app, start.x, start.y, start.z);
    }
  });
  return { kind: 'walk' as const, seconds, distance, ...frames };
}
