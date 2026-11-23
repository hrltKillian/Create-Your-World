import { blockItemKey } from '../../content/items.ts';
import { HOTBAR_SLOTS } from '../../core/player.ts';
import { rigDegrees } from '../../render/rigs.ts';
import { countItem } from '../../sim/inventory.ts';
import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import type { App } from '../App.ts';
import {
  frameOrFail,
  framesFor,
  give,
  hotbarView,
  look,
  press,
  setBlock,
  waitUntil,
  withinFrames,
} from '../automation.ts';
import {
  assert,
  assertTiming,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  slowFactor,
  standAt,
  stateKey,
} from './support.ts';

/**
 * M4 « Fait quand » browser checks on the flat world (?worldType=flat&fixedStep=1): digging,
 * placing, edit-to-mesh latency, the strike pose, the break sound and the shader precompilation
 * (the program count of the first case must not grow by the last one). The cases stand on columns
 * east of the spawn (feet on the surface, y FLAT_SURFACE + 1), away from where m3 walks and
 * builds, and can run again on the same page (the dig lays its ground back first, the other
 * edits are undone).
 */

/** Column the dig case empties (its ground is laid back first, so a rerun digs again). */
const DIG = { x: 6, z: 6 };
/** Column no case edits: the flat ground's surface (grass) and filler (dirt) are read here. */
const GROUND = { x: 7, z: 6 };
/** Where the placement and edit-to-mesh cases stand. */
const BUILD = { x: 10, z: 6 };
const STRIKE = { x: 14, z: 6 };

/** « look(0,-90); press('primary',60) »: grass breaks in 41 ticks, the dirt below would take 23. */
const DIG_TICKS = 60;
/** Edit to visible mesh (docs/conception.md « Mesure de performance »): 3 frames at 60 Hz. */
const EDIT_TO_MESH_MS = 50;
const EDIT_FRAMES = 3;
/** Pitch that aims at the ground about one block ahead from a standing eye. */
const GROUND_AHEAD_PITCH = -1;
/** Effectively "held until released". */
const HOLD_TICKS = 1e6;

/** Shader programs once loaded, before the cases dig, place, strike and open the bag (−1: unknown). */
let programsBeforePlay = -1;

function shaderPrograms(app: App): number {
  return app.renderer?.webgl.info.programs?.length ?? 0;
}

/** The flat ground's states, read from the GROUND column. */
function flatGround(app: App): { surface: number; filler: number } {
  const world = app.world!;
  return {
    surface: world.getBlock(GROUND.x, FLAT_SURFACE, GROUND.z),
    filler: world.getBlock(GROUND.x, FLAT_SURFACE - 1, GROUND.z),
  };
}

/** Mean interval (ms) of the next `n` animation frames. */
async function frameInterval(n: number): Promise<number> {
  await frameOrFail();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) await frameOrFail();
  return (performance.now() - t0) / n;
}

export const M4_SUITE: readonly SelftestCase[] = [
  {
    name: 'shader programs are compiled while loading (counted before the cases play)',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsFlatPlayer,
    run: async (app) => {
      await playerSession(app);
      programsBeforePlay = shaderPrograms(app);
      assert(programsBeforePlay > 0, 'no shader program after loading');
    },
  },
  {
    name: 'looking down, primary held for 60 ticks digs the grass: air below, 1 dirt, HUD "1"',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsFlatPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const registry = app.registry!;
      const world = session.host.view.world;
      const inventory = session.player.inventory;
      const { surface, filler } = flatGround(app);
      // The grass drops the dirt it lies on (loot), as the item of that block.
      const dirt = blockItemKey(registry.blockDef(filler).key);
      const { x, z } = DIG;
      setBlock(app, x, FLAT_SURFACE - 1, z, stateKey(app, filler));
      setBlock(app, x, FLAT_SURFACE, z, stateKey(app, surface));
      await standAt(app, DIG);
      look(app, 0, -Math.PI / 2);
      await frameOrFail();
      const before = countItem(inventory, dirt);
      press(app, 'primary', DIG_TICKS);
      const below = world.getBlock(x, FLAT_SURFACE, z);
      assert(below === registry.air, `the block below is ${stateKey(app, below)}, not air`);
      const gained = countItem(inventory, dirt) - before;
      assert(gained === 1, `the inventory gained ${gained} ${dirt}, not 1`);
      const slot = inventory.findIndex((stack) => stack?.item === dirt);
      assert(slot >= 0 && slot < HOTBAR_SLOTS, `${dirt} is in slot ${slot}, not in the hotbar`);
      // On a fresh page this is "1"; the HUD refreshes on the next frame.
      const expected = String(inventory[slot]!.count);
      const shown = () => hotbarView(app)?.counts[slot] ?? null;
      const ok = await withinFrames(10, () => shown() === expected);
      assert(ok, `hotbar slot ${slot + 1} shows "${shown()}", not "${expected}"`);
    },
  },
  {
    name: "the dig was heard: audio.log() has the grass's break sound (logged even with ?mute=1)",
    scenes: PLAY_SCENES,
    skip: needsFlatPlayer,
    run: (app) => {
      assert(app.audio, 'no audio engine');
      const expected = app.registry!.blockSfx(flatGround(app).surface, 'break');
      assert(expected, 'the grass has no break sound');
      const log = app.audio.log();
      assert(
        log.includes(expected),
        `audio.log() has no ${expected} after the dig (last: ${log.slice(-6).join(', ') || 'nothing'})`,
      );
    },
  },
  {
    name: 'secondary places the held block where the ghost shows it',
    scenes: PLAY_SCENES,
    skip: needsFlatPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const inventory = session.player.inventory;
      const air = stateKey(app, app.registry!.air);
      const dirt = blockItemKey(app.registry!.blockDef(flatGround(app).filler).key);
      await standAt(app, BUILD);
      give(app, dirt, 1);
      const slot = inventory.findIndex((stack) => stack?.item === dirt);
      assert(slot >= 0 && slot < HOTBAR_SLOTS, `${dirt} went to slot ${slot}, not the hotbar`);
      app.input!.slot = slot;
      look(app, 0, GROUND_AHEAD_PITCH);
      await frameOrFail();
      const ghost = { ...session.aim.ghost };
      assert(ghost.state >= 0, 'no placement ghost on the ground ahead');
      const before = countItem(inventory, dirt);
      try {
        press(app, 'secondary', 1);
        const placed = session.host.view.world.getBlock(ghost.x, ghost.y, ghost.z);
        assert(
          placed === ghost.state,
          `(${ghost.x}, ${ghost.y}, ${ghost.z}) holds ${stateKey(app, placed)}, not ${stateKey(app, ghost.state)}`,
        );
        const used = before - countItem(inventory, dirt);
        assert(used === 1, `placing used ${used} ${dirt}, not 1`);
      } finally {
        setBlock(app, ghost.x, ghost.y, ghost.z, air);
      }
    },
  },
  {
    name: 'an edit is on screen within 3 frames: sectionVersionLag() 0, editToMeshMs ≤ 50',
    scenes: PLAY_SCENES,
    timeoutMs: 45_000,
    skip: needsFlatPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const scheduler = session.scheduler;
      await standAt(app, BUILD);
      // Time the edit alone: the world around finishes streaming and meshing first.
      await waitUntil(() => scheduler.idle(), {
        timeoutMs: 30_000 * slowFactor(app),
        label: 'meshing still busy',
        pollMs: 50,
      });
      // 50 ms is 3 frames at 60 Hz; slower software-rendered frames (CI) get 3 of their own.
      const limit = Math.max(EDIT_TO_MESH_MS, EDIT_FRAMES * (await frameInterval(5)));
      const air = stateKey(app, app.registry!.air);
      const x = BUILD.x;
      const y = FLAT_SURFACE + 1;
      const z = BUILD.z - 4;
      try {
        setBlock(app, x, y, z, stateKey(app, flatGround(app).surface));
        const lag = () => scheduler.sectionVersionLag();
        assert(lag() > 0, 'the edit changed no section on screen');
        const shown = await withinFrames(EDIT_FRAMES, () => lag() === 0);
        assert(
          shown,
          `sectionVersionLag() is ${lag()} after ${EDIT_FRAMES} frames (${JSON.stringify(scheduler.stats())})`,
        );
        const ms = scheduler.editToMeshMs;
        assertTiming(app, ms <= limit, `editToMeshMs ${ms.toFixed(1)} > ${limit.toFixed(1)}`);
      } finally {
        setBlock(app, x, y, z, air);
      }
    },
  },
  {
    name: 'the avatar strikes while primary is held and rests after',
    scenes: PLAY_SCENES,
    skip: needsFlatPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      await standAt(app, STRIKE);
      // Level view: nothing within reach on the flat ground, so nothing is mined.
      look(app, 0, 0);
      const rig = () => {
        const state = session.entities.rig(session.player.id);
        assert(state, 'no avatar rig');
        return state;
      };
      // One tick per rendered frame for a wall-clock time: the pose eases per frame.
      const play = (ms: number) => framesFor(ms, () => session.step(1), 10);
      try {
        app.input!.force('primary', HOLD_TICKS);
        await play(400);
        const strike = rig().strike;
        const arm = rigDegrees(rig()).armR ?? 0;
        assert(strike > 0.9, `strike blend ${strike.toFixed(2)} while primary is held`);
        assert(arm < -40, `right arm at ${arm.toFixed(0)}° while striking (raised: < −40°)`);
      } finally {
        app.input!.force('primary', 0);
      }
      await play(500);
      const rest = rig().strike;
      assert(rest < 0.1, `strike blend ${rest.toFixed(2)} after release`);
    },
  },
  {
    name: 'digging, placing, striking, the third person and the bag compiled no new shader program',
    scenes: PLAY_SCENES,
    skip: needsFlatPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      assert(programsBeforePlay > 0, 'the first m4 case did not count the programs');
      const inventory = app.inventory;
      assert(inventory, 'no bag');
      const mode = session.rig.mode;
      try {
        session.rig.mode = 'third';
        await framesFor(200);
        inventory.toggleBag();
        assert(inventory.bag.isOpen(), 'the bag did not open');
        await framesFor(200);
      } finally {
        inventory.closeScreen(true);
        session.rig.mode = mode;
      }
      await frameOrFail();
      const programs = shaderPrograms(app);
      assert(
        programs === programsBeforePlay,
        `${programs - programsBeforePlay} shader program(s) compiled during play (${programsBeforePlay} → ${programs})`,
      );
    },
  },
  noErrorsCase('no errors and no missing strings after the m4 checks'),
];
