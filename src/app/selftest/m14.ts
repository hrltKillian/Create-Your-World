import { blockItemKey } from '../../content/items.ts';
import type { BlockDef } from '../../content/schema.ts';
import { BY_WORLD } from '../../sim/blockRemoval.ts';
import { ticksOf } from '../../sim/clock.ts';
import type { App } from '../App.ts';
import { frameOrFail, look, press, setBlock, waitForChunks } from '../automation.ts';
import {
  aimAt,
  assert,
  type Cell,
  eventsDuring,
  holdInHand,
  lookAt,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  standAt,
  stateKey,
} from './support.ts';

/**
 * M14 block updates (docs plan v2 « M14 — Mises à jour de blocs, feuilles, torches »), on the flat
 * world with fixed steps (?worldType=flat&fixedStep=1): a tree felled by the player loses its
 * canopy within the decay delay, harvested by the world, while a player's own leaves stay; a hung
 * block (torch) placed against a wall hangs there, the aim passes beside it to the wall, and it
 * pops off when that wall is broken. Blocks are found through the pack, never by content key.
 */

const TREE_SPOT = { x: -60, z: 0 };
const TORCH_SPOT = { x: -60, z: 16 };

/** The pack's first decaying block and the first block anchoring it (a log). */
function decayPair(app: App): { leaf: BlockDef; anchor: BlockDef } {
  const registry = app.registry!;
  const leaf = registry.blocks.find((def) => def.decay !== undefined);
  assert(leaf?.decay, 'the pack has no decaying block');
  const anchor = registry.blocks.find((def) => def.key === leaf.decay!.anchors[0]);
  assert(anchor, 'the decaying block has no anchor block');
  return { leaf, anchor };
}

/** The pack's first block that hangs on walls (a torch). */
function hungBlock(app: App): BlockDef {
  const block = app.registry!.blocks.find((def) => def.placement?.support === 'attach');
  assert(block, 'the pack has no block hung on walls');
  return block;
}

/** The text key of a block with some state values (the others at their defaults). */
function keyOf(app: App, block: BlockDef, props: Record<string, string>): string {
  const registry = app.registry!;
  let state = registry.defaultState(block.key);
  for (const [prop, value] of Object.entries(props))
    state = registry.withState(state, prop as 'attach', value);
  return stateKey(app, state);
}

const treeCase: SelftestCase = {
  name: 'a felled trunk drops its canopy within the decay delay; a player’s own leaves stay',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const { leaf, anchor } = decayPair(app);
    await standAt(app, TREE_SPOT);
    await waitForChunks(app, 1, 15_000);
    const base = { x: TREE_SPOT.x, y: 65, z: TREE_SPOT.z - 2 };
    const leafKey = keyOf(app, leaf, { placed: '0' });
    const placedKey = keyOf(app, leaf, { placed: '1' });
    // A one-log trunk under a ring of leaves (none in front of it, where the aim goes), one of them
    // a player's.
    setBlock(app, base.x, base.y, base.z, stateKey(app, app.registry!.defaultState(anchor.key)));
    const ring: [number, number][] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 0; dz++) ring.push([dx, dz]);
    ring.push([-1, 1], [1, 1]);
    for (const [dx, dz] of ring) setBlock(app, base.x + dx, 66, base.z + dz, leafKey);
    setBlock(app, base.x + 1, 66, base.z + 1, placedKey);
    const world = session.host.view.world;
    const leavesLeft = () =>
      ring.filter(
        ([dx, dz]) => stateKey(app, world.getBlock(base.x + dx, 66, base.z + dz)) === leafKey,
      ).length;
    assert(leavesLeft() === 7, `the canopy has ${leavesLeft()} leaves, not 7`);
    // The player fells the trunk by hand (the leaves above it are out of the way of the aim).
    look(app, 0, -0.6);
    await aimAt(app, base);
    const seconds = leaf.decay!.seconds;
    const events = eventsDuring(app, () => {
      press(app, 'primary', ticksOf(10));
      press(app, 'primary', 0);
      session.step(ticksOf(seconds[1]) + 10);
    });
    assert(
      stateKey(app, world.getBlock(base.x, base.y, base.z)) === stateKey(app, app.registry!.air),
      'the trunk was not felled',
    );
    assert(leavesLeft() === 0, `${leavesLeft()} leaves still hang there`);
    assert(
      stateKey(app, world.getBlock(base.x + 1, 66, base.z + 1)) === placedKey,
      'the player’s own leaf decayed',
    );
    const fallen = events.filter((e) => e.type === 'blockBroken' && e.playerId === BY_WORLD);
    assert(fallen.length === 7, `${fallen.length} leaves fell, not 7`);
  },
};

const torchCase: SelftestCase = {
  name: 'a torch hangs on the wall aimed at; the aim passes beside it; it falls with its wall',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const { anchor } = decayPair(app);
    const torch = hungBlock(app);
    await standAt(app, TORCH_SPOT);
    await waitForChunks(app, 1, 15_000);
    const wall: Cell = { x: TORCH_SPOT.x, y: 66, z: TORCH_SPOT.z - 3 };
    const hung: Cell = { x: wall.x, y: wall.y, z: wall.z + 1 };
    setBlock(app, wall.x, wall.y, wall.z, stateKey(app, app.registry!.defaultState(anchor.key)));
    holdInHand(app, blockItemKey(torch.key), 1);
    await aimAt(app, wall);
    press(app, 'secondary', 1);
    press(app, 'secondary', 0);
    const world = session.host.view.world;
    const hungKey = keyOf(app, torch, { attach: 'n' });
    const placed = stateKey(app, world.getBlock(hung.x, hung.y, hung.z));
    assert(placed === hungKey, `the torch went in as ${placed}, not ${hungKey}`);
    // Beside the torch's stick, the aim reaches the wall behind it.
    await lookAt(app, hung.x + 0.15, hung.y + 0.5, wall.z + 0.99);
    await frameOrFail();
    const hit = session.aim.hit;
    assert(
      hit.hit && hit.x === wall.x && hit.y === wall.y && hit.z === wall.z,
      `beside the torch the aim hits ${hit.hit ? `(${hit.x}, ${hit.y}, ${hit.z})` : 'nothing'}`,
    );
    // The wall goes: the torch pops off with it, dropping itself.
    const events = eventsDuring(app, () => {
      press(app, 'primary', ticksOf(10));
      press(app, 'primary', 0);
    });
    const air = stateKey(app, app.registry!.air);
    assert(stateKey(app, world.getBlock(wall.x, wall.y, wall.z)) === air, 'the wall still stands');
    assert(stateKey(app, world.getBlock(hung.x, hung.y, hung.z)) === air, 'the torch still hangs');
    assert(
      events.some((e) => e.type === 'blockBroken' && e.playerId === BY_WORLD && e.z === hung.z),
      'the torch did not fall',
    );
  },
};

export const M14_SUITE: readonly SelftestCase[] = [
  treeCase,
  torchCase,
  noErrorsCase('no errors after the m14 checks'),
];
