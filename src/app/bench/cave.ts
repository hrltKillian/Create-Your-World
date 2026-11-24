import { EYE_HEIGHT } from '../../core/player.ts';
import { type FoundCave, findCave } from '../../world/gen/find.ts';
import { isFlatWorld } from '../../world/gen/generateColumn.ts';
import type { App } from '../App.ts';
import { clock, framesFor, freezeTime, look, setTime, waitUntil } from '../automation.ts';
import { god } from '../survivalAutomation.ts';
import { teleportAndWait } from './place.ts';
import { sampleFrames } from './sampler.ts';

/**
 * The `cave` benchmark (docs M11 « Fait quand »): the view from a fixed pose deep underground,
 * with the cave culling on, then off at the same pose (« −30 % de draws sous terre par rapport à
 * `occlusion=0` », « `cave` : ≤ 150 draws »).
 */

export const CAVE = {
  seconds: 4,
  /** The pose: the first cave pocket this close to the spawn, its floor this deep under the surface. */
  radius: 160,
  minDepth: 48,
  /** Looking north along the horizon. */
  yaw: 0,
  pitch: 0,
  /** The camera, the culling and the frame counters settle this long before each half. */
  settleMs: 400,
  /** Longest wait for the render distance around the pose to be meshed. */
  loadMs: 60_000,
  hour: 12,
} as const;

/** The benchmark's pose in a world: a cave pocket near the spawn (deterministic per seed). */
export function cavePose(app: App): FoundCave {
  const session = app.session;
  if (!session) throw new Error('No world session');
  const gen = session.host.view.gen;
  if (isFlatWorld(gen.worldType)) throw new Error('cave needs the generated world');
  const cave = findCave(gen, session.spawn, CAVE.radius, CAVE.minDepth);
  if (!cave) throw new Error(`no cave pocket within ${CAVE.radius} blocks of the spawn`);
  return cave;
}

/**
 * Takes the player (or the free camera) to the cave pose, waits for the render distance around it
 * to be meshed, then samples `seconds / 2` with the cave culling on and as long with it off.
 * Draws and triangles of each half, the draws the culling saves, the sections it hides and its
 * walk's time. The pose, the culling switch, the clock and the player's immunity are put back.
 */
export async function caveBenchmark(app: App, seconds: number = CAVE.seconds) {
  const session = app.session;
  const occlusion = app.view?.chunks.occlusion;
  const time = clock(app);
  if (!session || !occlusion || !time) throw new Error('No world session');
  const cave = cavePose(app);
  const wasOn = occlusion.isEnabled();
  const immune = session.player.survival.god;
  const cam = app.freecam;
  const camStart = cam ? { ...cam.pose } : null;
  const body = session.player.body;
  const start = { x: body.x, y: body.y, z: body.z, yaw: session.rig.yaw, pitch: session.rig.pitch };
  const x = cave.x + 0.5;
  const z = cave.z + 0.5;
  try {
    setTime(app, CAVE.hour);
    freezeTime(app, true);
    god(app, true);
    if (cam) cam.set({ x, y: cave.y + EYE_HEIGHT, z, yaw: CAVE.yaw, pitch: CAVE.pitch });
    else await teleportAndWait(app, x, cave.y, z);
    await waitUntil(() => !session.loading && session.chunksReady(session.renderDistance), {
      timeoutMs: CAVE.loadMs,
      label: `render distance ${session.renderDistance} around the cave not meshed`,
      pollMs: 50,
    });
    const hold = () => look(app, CAVE.yaw, CAVE.pitch);
    occlusion.setEnabled(true);
    await framesFor(CAVE.settleMs, hold);
    const on = await sampleFrames(app, seconds / 2, hold);
    const hidden = app.view!.chunks.stats().hidden;
    const walk = occlusion.stats();
    occlusion.setEnabled(false);
    await framesFor(CAVE.settleMs, hold);
    const off = await sampleFrames(app, seconds / 2, hold);
    return {
      kind: 'cave' as const,
      seconds,
      pose: { x, y: cave.y, z, yaw: CAVE.yaw, pitch: CAVE.pitch },
      draws: on.draws,
      drawsOff: off.draws,
      /** Share of the draws the culling saves (« −30 % »). */
      saved: off.draws > 0 ? 1 - on.draws / off.draws : 0,
      triangles: on.triangles,
      trianglesOff: off.triangles,
      hidden,
      reached: walk.reached,
      walkMs: walk.lastMs,
      workP95: on.workP95,
      workP95Off: off.workP95,
    };
  } finally {
    occlusion.setEnabled(wasOn);
    if (cam && camStart) cam.set(camStart);
    else {
      look(app, start.yaw, start.pitch);
      await teleportAndWait(app, start.x, start.y, start.z);
    }
    god(app, immune);
    setTime(app, time.hour);
    freezeTime(app, time.frozen);
  }
}
