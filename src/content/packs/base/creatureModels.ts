import { glimmerback } from './beasts/glimmerback.ts';
import { prowler } from './beasts/prowler.ts';
import { reedwader } from './beasts/reedwader.ts';
import { shagback } from './beasts/shagback.ts';
import { shellback } from './beasts/shellback.ts';
import { swarmling } from './beasts/swarmling.ts';
import { trotter } from './beasts/trotter.ts';

/*
 * The creatures' box models and skin atlases (plan v5 « M52 », docs « Animation »): jointed
 * models (two-segment legs, necks, jaws, ears, segmented tails, rest rotations), each skinned by
 * one atlas painted texel by texel in the palette (beasts/paint.ts) and unfolded the reference
 * game's way (beasts/build.ts). Legs are named for their gait (GAIT_LEGS), their lower segments
 * `shin…`; parts the renderer animates by name: render/creatureRig.ts.
 */
const beasts = [trotter, shagback, prowler, swarmling, shellback, glimmerback, reedwader];

export const creatureModels = beasts.map((b) => b.model);
export const creatureSkins = beasts.map((b) => b.skin);
