import { EYE_HEIGHT } from '../../core/player.ts';
import { type FoundCave, findCave } from '../../world/gen/find.ts';
import { isFlatWorld } from '../../world/gen/generateColumn.ts';
import type { App } from '../App.ts';
import { frameOrFail, framesFor, look, waitUntil } from '../automation.ts';
import { sampleFrames } from './sampler.ts';
import { staged, teleportAndWait } from './stage.ts';

/**
 * The `cave` benchmark (docs M11 « Fait quand »): the view from a fixed pose deep underground,
 * with the cave culling on, then off at the same pose (« −30 % de draws sous terre par rapport à
 * `occlusion=0` », « `cave` : ≤ 150 draws »). What the culling saves is counted over a whole
 * turn: in one heading it depends on the seed (sections behind the camera are culled by the
 * frustum anyway).
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
  /** Headings of the turn the saved draws are counted at, one frame each. */
  headings: 8,
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
 * to be meshed, then samples `seconds / 2` with the cave culling on and as long with it off, and
 * counts the draws of a turn each time. Draws and triangles of each half, the draws the culling
 * saves over the turn, the sections it hides and its walk's time. The pose, the culling switch, the clock and the player's immunity are put back.
 */
export async function caveBenchmark(app: App, seconds: number = CAVE.seconds) {
  const session = app.session;
  const occlusion = app.view?.chunks.occlusion;
  if (!session || !occlusion) throw new Error('No world session');
  const cave = cavePose(app);
  const wasOn = occlusion.isEnabled();
  const cam = app.freecam;
  const camStart = cam ? { ...cam.pose } : null;
  const body = session.player.body;
  const start = { x: body.x, y: body.y, z: body.z, yaw: session.rig.yaw, pitch: session.rig.pitch };
  const x = cave.x + 0.5;
  const z = cave.z + 0.5;
  return staged(app, CAVE.hour, async () => {
    try {
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
      const turnOn = await drawsAround(app);
      const hidden = app.view!.chunks.stats().hidden;
      const walk = occlusion.stats();
      occlusion.setEnabled(false);
      await framesFor(CAVE.settleMs, hold);
      const off = await sampleFrames(app, seconds / 2, hold);
      const turnOff = await drawsAround(app);
      return {
        kind: 'cave' as const,
        seconds,
        pose: { x, y: cave.y, z, yaw: CAVE.yaw, pitch: CAVE.pitch },
        draws: on.draws,
        drawsOff: off.draws,
        /** Draws a frame over the turn, on average, with the culling and without. */
        turnDraws: turnOn,
        turnDrawsOff: turnOff,
        /** Share of the draws the culling saves over the turn (« −30 % »). */
        saved: turnOff > 0 ? 1 - turnOn / turnOff : 0,
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
    }
  });
}

/**
 * Draws a frame on average over a turn: one frame at each of CAVE.headings yaws (the culling as
 * it is set). Frame-counted, so a slow renderer counts the same turn.
 */
async function drawsAround(app: App): Promise<number> {
  const webgl = app.renderer!.webgl;
  let sum = 0;
  for (let k = 0; k < CAVE.headings; k++) {
    look(app, CAVE.yaw + (Math.PI * 2 * k) / CAVE.headings, CAVE.pitch);
    // The first frame may have started before the turn: the second is drawn facing it.
    await frameOrFail();
    await frameOrFail();
    sum += webgl.info.render.calls;
  }
  return sum / CAVE.headings;
}
