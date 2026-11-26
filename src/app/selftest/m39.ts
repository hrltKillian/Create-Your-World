import { findBiome } from '../../world/gen/find.ts';
import type { App } from '../App.ts';
import {
  freezeTime,
  look,
  setTime,
  setWeather,
  waitForChunks,
  withinFrames,
} from '../automation.ts';
import { teleportAndWait } from '../bench/stage.ts';
import {
  assert,
  keepingClock,
  needsFlatPlayer,
  needsGeneratedPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  SEARCH_RADIUS,
  type SelftestCase,
  standAt,
} from './support.ts';

/*
 * M39 the sky of Veyra (plan v4 « M39 »): in the generated world (?seed=7&rd=4&fixedStep=1), at
 * midnight, the sky over the pack's biome with the strongest auroras is brighter than over the
 * spawn; on the flat world with fixed steps, a storm's clouds darken the noon sky.
 */

/** A place of the flat world no other case builds on. */
const OPEN_SKY = { x: 64, z: -64 };

/** Frames the sky gets to ease (the air over 4 s, the weather over 5 s). */
const EASE_FRAMES = 600;

/** The sky's mean brightness, looking up. */
function skyLuma(app: App): number {
  return app.view!.capture().avgLuma;
}

const auroraCase: SelftestCase = {
  name: 'the midnight sky over the land of auroras is brighter than over the spawn',
  scenes: PLAY_SCENES,
  skip: (app) => needsGeneratedPlayer(app) ?? (app.params.fixedStep ? null : 'needs ?fixedStep'),
  timeoutMs: 120_000,
  run: async (app) => {
    const session = await playerSession(app);
    const gen = session.host.view.gen;
    const biomes = [...(app.registry!.pack.biomes ?? [])];
    const cold = biomes.sort((a, b) => (b.aurora ?? 0) - (a.aurora ?? 0))[0];
    assert(cold && (cold.aurora ?? 0) > 0, 'the pack has no biome with auroras');
    const home = { x: Math.floor(session.spawn.x), z: Math.floor(session.spawn.z) };
    const hit = findBiome(gen, cold.key, home, SEARCH_RADIUS);
    assert(hit, `no ${cold.key} within ${SEARCH_RADIUS} blocks`);
    await keepingClock(app, async () => {
      setTime(app, 0);
      freezeTime(app, true);
      setWeather(app, 'clear');
      try {
        look(app, 0, 0.35);
        await withinFrames(EASE_FRAMES / 4, () => false);
        const plain = skyLuma(app);
        await teleportAndWait(app, hit.x + 0.5, 'surface', hit.z + 0.5);
        await waitForChunks(app, 1, 30_000);
        look(app, 0, 0.35);
        const lit = await withinFrames(EASE_FRAMES, () => skyLuma(app) > plain * 1.15);
        assert(lit, `the sky stays at ${skyLuma(app).toFixed(3)} (${plain.toFixed(3)} at home)`);
      } finally {
        setWeather(app, null);
        look(app, 0, 0);
        await teleportAndWait(app, session.spawn.x, 'surface', session.spawn.z);
      }
    });
  },
};

const stormCase: SelftestCase = {
  name: "a storm's clouds darken the noon sky",
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  // The weather eases in real time: slow frames (a hidden page) need more of them.
  timeoutMs: 120_000,
  run: async (app) => {
    await playerSession(app);
    await keepingClock(app, async () => {
      setTime(app, 12);
      freezeTime(app, true);
      setWeather(app, 'clear');
      // An open place away from the other cases' builds, looking well up into the sky.
      await standAt(app, OPEN_SKY);
      look(app, 0, 1);
      try {
        await withinFrames(EASE_FRAMES, () => app.session!.weather.state.cloud === 0);
        const clear = skyLuma(app);
        setWeather(app, 'storm');
        const dark = await withinFrames(EASE_FRAMES, () => skyLuma(app) < clear * 0.8);
        assert(dark, `the stormy sky is ${skyLuma(app).toFixed(3)}, clear ${clear.toFixed(3)}`);
      } finally {
        setWeather(app, null);
        look(app, 0, 0);
      }
    });
  },
};

export const M39_SUITE: readonly SelftestCase[] = [
  auroraCase,
  stormCase,
  noErrorsCase('no errors after the m39 checks'),
];
