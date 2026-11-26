import { give, withinFrames } from '../automation.ts';
import { colours, ICON_FRAMES } from './m49.ts';
import { openBag } from './screenSteps.ts';
import {
  assert,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  waitForSlot,
} from './support.ts';

/*
 * M50 block icons drawn by hand (plan v5 « M50 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): the Bag shows a chest's item with its drawn 32 × 32 art (not a
 * cube rendered from the block's textures), every pixel a colour of the art's palette.
 */

const iconCase: SelftestCase = {
  name: 'the Bag shows a block’s item with its hand-drawn art, every pixel a colour of its palette',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  timeoutMs: 60_000,
  run: async (app) => {
    const session = await playerSession(app);
    const registry = app.registry!;
    const chest = registry.pack.blocks.find((b) => b.blockEntity === 'container');
    assert(chest?.item?.art, 'the pack has no chest with drawn art');
    const item = registry.items.find(
      (it) => typeof it.icon !== 'string' && it.icon.block === chest.key,
    );
    assert(item, 'the chest has no item');
    const inventory = session.player.inventory;
    give(app, item.key, 1);
    const slot = inventory.findIndex((stack) => stack?.item === item.key);
    assert(slot >= 0, 'the gift is not in the inventory');
    try {
      openBag(app, 'inventory');
      const img = () =>
        document.querySelector<HTMLImageElement>(`#screen-bag [data-slot="${slot}"] img`);
      await waitForSlot('bag', slot);
      const loaded = () => (img()?.complete ?? false) && img()!.naturalWidth > 0;
      assert(await withinFrames(ICON_FRAMES, loaded), `no icon in slot ${slot}`);
      const icon = img()!;
      assert(icon.naturalWidth === 32, `the icon is ${icon.naturalWidth} pixels wide`);
      const art = registry.pack.icons?.find((t) => t.key === chest.item!.art);
      assert(art?.mask, 'the art is not drawn from a grid');
      const palette = new Set(art.palette);
      // The slot may still show what an earlier case left there until the screen refreshes it.
      const strayNow = () => [...colours(img()!)].filter((c) => !palette.has(c));
      await withinFrames(ICON_FRAMES, () => strayNow().length === 0);
      const stray = strayNow();
      assert(stray.length === 0, `colours off its art: ${stray.slice(0, 4).join(', ')}`);
    } finally {
      app.inventory!.closeScreen();
      const stack = inventory[slot];
      if (stack && stack.count > 1) stack.count--;
      else inventory[slot] = null;
    }
  },
};

export const M50_SUITE: readonly SelftestCase[] = [
  iconCase,
  noErrorsCase('no errors after the m50 checks'),
];
