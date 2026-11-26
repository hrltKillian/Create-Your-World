import type { Registry } from '../content/registry.ts';
import type { CameraPose, WorldView } from '../render/WorldView.ts';
import { NIGHT_DAYLIGHT } from '../sim/time.ts';

/*
 * Veyra's night sky behind the main menu (plan v4 « M43 »): the view looks up north-east at the
 * ringed giant from high above the world, the stars turn slowly, the moons show their phases and
 * the auroras of the pack's coldest air rise in.
 */

/** The hour the sky starts at, and how many hours a second it turns. */
const START_HOUR = 22.6;
const HOURS_A_SECOND = 0.004;
/** Days into the world: the moons' phases. */
const DAYS = 2.3;
/** High above any land, looking up north: the giant hangs up to the right. */
const POSE: CameraPose = { x: 0, y: 900, z: 0, yaw: -0.15, pitch: 0.5 };

/** Runs the title sky on `runLoop` until another loop replaces it. */
export function runTitleSky(
  view: WorldView,
  registry: Registry,
  runLoop: (frame: (dt: number) => void) => void,
): void {
  const biomes = registry.pack.biomes ?? [];
  const cold = biomes.reduce<(typeof biomes)[number] | undefined>(
    (best, biome) => ((biome.aurora ?? 0) > (best?.aurora ?? 0) ? biome : best),
    undefined,
  );
  view.setAir(cold?.fog ?? null, cold?.aurora ?? 0);
  view.setUnderwater(false);
  let seconds = 0;
  runLoop((dt) => {
    seconds += dt;
    view.setTime((START_HOUR + seconds * HOURS_A_SECOND) % 24, NIGHT_DAYLIGHT, DAYS);
    view.setPose(POSE);
    view.frame(dt);
  });
}
