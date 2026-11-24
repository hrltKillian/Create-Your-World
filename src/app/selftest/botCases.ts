import { TICKS_PER_SECOND } from '../../sim/clock.ts';
import { teleport, waitUntil, withinFrames } from '../automation.ts';
import { driveBot } from '../botDriver.ts';
import { kill } from '../survivalAutomation.ts';
import {
  assert,
  chunksMeshed,
  needsGeneratedPlayer,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
} from './support.ts';

/**
 * M11 « un bot wanderMineBuild tourne … dans le navigateur → errors() vide », in the generated
 * world with a player (fixed steps or real time; the flat and arena worlds have nothing for it to
 * do): the bot plays a short run away from the spawn (the earlier suites build around it) without
 * an error, and brings a dead player back. The five-minute run is
 * `__game.bot.run('wanderMineBuild', 300)`. What the bot does (mining, building, meals) depends on
 * the ground it lands on, so these cases only check that it plays; the headless runs and the unit
 * tests check its behaviour.
 */

/** Game seconds of the run: quick with fixed steps (8 ticks a frame), in wall time otherwise. */
const FIXED_SECONDS = 60;
const REAL_SECONDS = 20;
/** Where the run takes place (columns no other suite edits), and how long it may take to load. */
const BOT_SPOT = { x: 160.5, z: -160.5 };
const LOAD_MS = 25_000;
/** Frames for the HUD (10 Hz) to follow the respawn. */
const UI_FRAMES = 30;

export const BOT_CASES: readonly SelftestCase[] = [
  {
    name: 'the wanderMineBuild bot plays the player away from the spawn without an error',
    scenes: PLAY_SCENES,
    timeoutMs: 90_000,
    skip: needsGeneratedPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      teleport(app, BOT_SPOT.x, 'surface', BOT_SPOT.z);
      const b = session.player.body;
      // Real-time sessions apply the teleport on their next tick (a hidden page ticks here).
      await waitUntil(() => Math.abs(b.x - BOT_SPOT.x) + Math.abs(b.z - BOT_SPOT.z) < 1, {
        timeoutMs: 5000,
        label: 'the teleport to the bot spot did not happen',
        pump: () => session.pumpOnce(document.hidden),
      });
      await chunksMeshed(app, session.loadingRadius(), LOAD_MS);
      const seconds = app.params.fixedStep ? FIXED_SECONDS : REAL_SECONDS;
      const report = await driveBot(app, 'wanderMineBuild', seconds);
      assert(report.errors.length === 0, `errors during the run: ${report.errors.join(' | ')}`);
      assert(report.ticks >= seconds * TICKS_PER_SECOND, `the run lasted ${report.ticks} ticks`);
      const moved = Math.abs(report.x - BOT_SPOT.x) + Math.abs(report.z - BOT_SPOT.z);
      assert(moved > 2 || report.respawns > 0, `the bot stayed within ${moved.toFixed(2)} m`);
    },
  },
  {
    name: 'the bot brings a dead player back (Respawn) and the death screen closes',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsGeneratedPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      kill(app, 'fall');
      const report = await driveBot(app, 'wanderMineBuild', 2);
      assert(report.respawns > 0, 'the bot did not ask to respawn');
      assert(!session.player.survival.dead, 'the player is still dead');
      const closed = await withinFrames(UI_FRAMES, () => app.hud?.deathOpen() === false);
      assert(closed, 'the death screen stays open after the respawn');
    },
  },
];
