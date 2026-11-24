import { TICKS_PER_SECOND } from '../../sim/clock.ts';
import type { App } from '../App.ts';
import { clock, freezeTime, look, setTime } from '../automation.ts';
import { god } from '../survivalAutomation.ts';
import { teleportAndWait } from './place.ts';
import { type FrameResult, sampleFrames } from './sampler.ts';

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
  /** Blocked for this long (s) despite the jumps, it turns a quarter to the right. */
  turnAfter: 1.5,
} as const;

/**
 * The player walks for `seconds` of real ticks (the pane must be visible) from where it stands,
 * jumping onto steps and turning away from walls, with the world streaming around it; immune,
 * at noon. Frame statistics, and the blocks walked. The player, the clock and its immunity are
 * put back after.
 */
export async function walkBenchmark(app: App, seconds: number = WALK.seconds) {
  const session = app.session;
  const input = app.input;
  const time = clock(app);
  if (!session || !input || !time || app.freecam) throw new Error('walk needs a player');
  if (app.params.fixedStep) throw new Error('walk needs real ticks (no ?fixedStep)');
  const body = session.player.body;
  const start = { x: body.x, y: body.y, z: body.z };
  const immune = session.player.survival.god;
  let yaw = session.rig.yaw;
  let distance = 0;
  let lastX = body.x;
  let lastZ = body.z;
  let blockedSince = -1;
  const step = (t: number) => {
    distance += Math.hypot(body.x - lastX, body.z - lastZ);
    lastX = body.x;
    lastZ = body.z;
    const blocked = body.onGround && Math.hypot(body.vx, body.vz) < WALK.blockedSpeed;
    if (!blocked) blockedSince = -1;
    else if (blockedSince < 0) blockedSince = t;
    else if (t - blockedSince > WALK.turnAfter) {
      yaw -= Math.PI / 2;
      blockedSince = -1;
    }
    look(app, yaw, WALK.pitch);
    // Up a step, or up to the surface of water.
    if (blocked || body.inWater) input.force('jump', 2);
  };
  let frames: FrameResult;
  try {
    setTime(app, WALK.hour);
    freezeTime(app, true);
    god(app, true);
    input.force('forward', Math.ceil((seconds + 1) * TICKS_PER_SECOND));
    frames = await sampleFrames(app, seconds, step);
  } finally {
    input.force('forward', 0);
    input.force('jump', 0);
    god(app, immune);
    setTime(app, time.hour);
    freezeTime(app, time.frozen);
    await teleportAndWait(app, start.x, start.y, start.z);
  }
  return { kind: 'walk' as const, seconds, distance, ...frames };
}
