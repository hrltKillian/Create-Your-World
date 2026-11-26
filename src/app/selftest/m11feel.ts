import { BOB, SPRINT_FOV } from '../../render/CameraRig.ts';
import type { HandView } from '../../render/HandView.ts';
import { STAMINA } from '../../sim/player.ts';
import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import type { App } from '../App.ts';
import { frameOrFail, framesFor, look, waitUntil, withinFrames } from '../automation.ts';
import { feelView, setViewBob } from '../feelAutomation.ts';
import { setStat } from '../survivalAutomation.ts';
import {
  assert,
  assertTiming,
  needsFlatPlayer,
  PLAY_SCENES,
  playerSession,
  SETTLE_MS,
  type SelftestCase,
  standAt,
} from './support.ts';

/**
 * M11 render feel checks (docs « Rendu », « Caméra 1re personne »), on the flat world with fixed
 * steps (?worldType=flat&fixedStep=1): particles of every kind share the world batch's one draw
 * call; the first-person hand lags behind a turn of the view and comes back to rest; sprinting
 * widens the view by 8° and bobs it, both settling once the player stops. The player stands on
 * flat ground no other case edits and runs north from there.
 */

const FEEL = { x: 40, z: 0 };
/** Frames the sprint lasts (one tick a frame: about 12 blocks north). */
const SPRINT_FRAMES = 40;
/** The hand is back at rest within this (m), the view at its setting once the sprint is over. */
const REST = 1e-3;
/** Frames given to come back to rest (1 s at 240 fps), and the third-person camera to settle. */
const REST_FRAMES = 240;
const SETTLE_FRAMES = 600;
/** Turn of the view (radians: left and up) whose lag the hand shows. */
const TURN_YAW = 0.4;
const TURN_PITCH = 0.2;

/** Draw calls of the last whole frame (the counters are reset at the start of each one). */
async function drawsNow(app: App): Promise<number> {
  await frameOrFail();
  await frameOrFail();
  return app.renderer!.webgl.info.render.calls;
}

/** Renders frames until the camera holds still (the third-person distance eased out). */
async function cameraSettled(app: App): Promise<void> {
  const pose = app.session!.rig.pose;
  let x = Number.NaN;
  let y = Number.NaN;
  let z = Number.NaN;
  const still = await withinFrames(SETTLE_FRAMES, () => {
    const moved = Math.abs(pose.x - x) + Math.abs(pose.y - y) + Math.abs(pose.z - z);
    x = pose.x;
    y = pose.y;
    z = pose.z;
    return moved < 1e-5;
  });
  assert(still, 'the camera never settled');
}

/** Translation x (view space) of the hand's first box, the forearm. */
function armX(hand: HandView): number {
  return hand.batch.mesh.instanceMatrix.array[12]!;
}

const particlesDrawCase: SelftestCase = {
  name: 'chips, dust and an attack trail add no draw call: they share the world batch',
  scenes: PLAY_SCENES,
  timeoutMs: 60_000,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    await standAt(app, FEEL);
    const rd = session.renderDistance;
    // Chunks meshed while the case runs would change the count.
    await waitUntil(() => session.chunksReady(rd), {
      timeoutMs: 50_000,
      label: `render distance ${rd} not meshed`,
      pump: () => session.pumpOnce(false),
      pollMs: 50,
    });
    const { rig, play } = session;
    const particles = play.particles;
    const wasOn = particles.enabled;
    particles.setEnabled(true);
    // In third person the avatar is in the batch already, so its one draw is counted without
    // particles too.
    rig.mode = 'back';
    try {
      look(app, 0, -0.3);
      await cameraSettled(app);
      const before = await drawsNow(app);
      const boxes = play.batch.size;
      assert(boxes > 0, 'the avatar is not drawn in third person');
      const ground = session.host.view.world.getBlock(FEEL.x, FLAT_SURFACE, FEEL.z - 2);
      for (let dx = -1; dx <= 1; dx++)
        particles.burst(FEEL.x + dx, FLAT_SURFACE + 1, FEEL.z - 2, ground);
      particles.mineDust(FEEL.x, FLAT_SURFACE, FEEL.z - 2, ground, rig.eye.x, rig.eye.y, rig.eye.z);
      particles.landDust(FEEL.x + 0.5, FLAT_SURFACE + 1, FEEL.z + 0.5, ground, 4);
      particles.trail(rig.eye.x, rig.eye.y, rig.eye.z, rig.yaw, rig.pitch);
      const after = await drawsNow(app);
      const alive = particles.alive();
      assert(alive > 0, 'no particle is alive two frames after spawning them');
      assert(
        play.batch.size > boxes,
        `the batch holds ${play.batch.size} boxes, as without particles`,
      );
      assert(after === before, `${after} draws with ${alive} particles, ${before} without`);
    } finally {
      rig.mode = 'first';
      particles.setEnabled(wasOn);
    }
  },
};

const handSwayCase: SelftestCase = {
  name: 'the first-person hand lags behind a turn of the view, then comes back to rest',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    await standAt(app, FEEL);
    const hand = session.play.hand;
    session.rig.mode = 'first';
    look(app, 0, 0);
    const resting = () => Math.abs(hand.swayX) + Math.abs(hand.swayY) + Math.abs(hand.swayZ) < REST;
    assert(await withinFrames(REST_FRAMES, resting), 'the hand never comes to rest');
    assert(hand.visible, 'the hand is not drawn in first person');
    const rest = armX(hand);
    // A turn to the left leaves the hand on the right, a look up leaves it lower.
    look(app, TURN_YAW, TURN_PITCH);
    const lagged = await withinFrames(3, () => hand.swayX > 0.02 && hand.swayY < -0.01);
    assert(lagged, `after a turn the hand sways (${hand.swayX}, ${hand.swayY}), not right and low`);
    assert(armX(hand) > rest + 0.01, `the forearm stays at x ${armX(hand)} (${rest} at rest)`);
    assert(await withinFrames(REST_FRAMES, resting), `the hand stays off rest (${hand.swayX})`);
    assert(Math.abs(armX(hand) - rest) < REST, `the forearm rests at ${armX(hand)}, not ${rest}`);
    look(app, 0, 0);
  },
};

const sprintCase: SelftestCase = {
  name: 'sprinting widens the view by 8° and bobs it; both settle once the player stops',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    await standAt(app, FEEL);
    const rig = session.rig;
    const bobbed = rig.viewBob;
    setViewBob(app, true);
    rig.mode = 'first';
    look(app, 0, 0);
    setStat(app, 'stamina', STAMINA.max);
    try {
      await framesFor(SETTLE_MS);
      const base = feelView(app)!;
      assert(base.fovOffset === 0, `the view is ${base.fovOffset}° wide of its setting at rest`);
      const bob = await sprintNorth(app);
      const sprint = feelView(app)!;
      assert(
        sprint.fovOffset > SPRINT_FOV * 0.75 && sprint.fovOffset <= SPRINT_FOV,
        `sprinting widens the view by ${sprint.fovOffset}°, not about ${SPRINT_FOV}°`,
      );
      assert(
        Math.abs(sprint.fov - base.fov - sprint.fovOffset) < 1e-9,
        `the camera's field of view is ${sprint.fov}°, not ${base.fov}° + ${sprint.fovOffset}°`,
      );
      assert(bob > 0 && bob <= BOB + 1e-9, `the view bobs ${bob} m sprinting, not up to ${BOB}`);
      // Its whole amplitude needs real frame times: the rig reads the speed off the frames, and a
      // loaded software renderer (?timing=0) makes a sprint look slow.
      assertTiming(app, bob > BOB / 2, `the view bobs ${bob} m sprinting, not ${BOB}`);
      // Released: the player slows down and stops, the view narrows back and stops bobbing.
      let settled = false;
      for (let i = 0; i < REST_FRAMES && !settled; i++) {
        session.step(1);
        await frameOrFail();
        settled = rig.fovOffset === 0 && Math.abs(rig.pose.y - rig.eye.y) < REST;
      }
      const now = feelView(app)!;
      assert(
        settled,
        `after the sprint the view is ${now.fovOffset}° wide, ${now.bob} m off the eye`,
      );
      assert(
        now.fov === base.fov,
        `the field of view is ${now.fov}° after the sprint, not ${base.fov}°`,
      );
    } finally {
      setViewBob(app, bobbed);
    }
  },
};

/**
 * Sprints north for SPRINT_FRAMES frames, one tick a frame (fixed steps), and returns the largest
 * camera offset from the eye seen meanwhile (the bob).
 */
async function sprintNorth(app: App): Promise<number> {
  const session = app.session!;
  const input = app.input!;
  const rig = session.rig;
  let bob = 0;
  for (let i = 0; i < SPRINT_FRAMES; i++) {
    input.force('forward', 2);
    input.force('sprint', 2);
    session.step(1);
    await frameOrFail();
    bob = Math.max(bob, Math.abs(rig.pose.y - rig.eye.y));
  }
  assert(session.player.sprinting, 'the player is not sprinting');
  return bob;
}

/** The render feel cases, for the M11 suite (which ends with its own noErrorsCase). */
export const FEEL_CASES: readonly SelftestCase[] = [particlesDrawCase, handSwayCase, sprintCase];
