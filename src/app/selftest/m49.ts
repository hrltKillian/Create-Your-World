import { give, withinFrames } from '../automation.ts';
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
 * M49 hand-drawn item icons (plan v5 « M49 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): the Bag shows a food that plants (the pack's berries) with its
 * 32 × 32 pixel art, every pixel one of its palette's colours (no shading added on top).
 */

/** Frames the page gets to draw its icons and the Bag to show them. */
const ICON_FRAMES = 600;

/** The distinct colours of an image's opaque pixels, as `#rrggbb`. */
function colours(img: HTMLImageElement): Set<string> {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const seen = new Set<string>();
  for (let i = 0; i < data.length; i += 4)
    if (data[i + 3] === 255)
      seen.add(
        `#${(((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!) + 0x1000000).toString(16).slice(1)}`,
      );
  return seen;
}

const iconCase: SelftestCase = {
  name: 'the Bag shows a hand-drawn 32 × 32 icon, every pixel a colour of its palette',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  timeoutMs: 60_000,
  run: async (app) => {
    const session = await playerSession(app);
    const fruit = app.registry!.pack.items?.find((item) => item.places && item.consume);
    assert(fruit, 'the pack has no food that plants');
    const inventory = session.player.inventory;
    give(app, fruit.key, 1);
    // Where the gift went: an empty slot, or a stack of it an earlier case left.
    const slot = inventory.findIndex((stack) => stack?.item === fruit.key);
    assert(slot >= 0, 'the gift is not in the inventory');
    try {
      openBag(app, 'inventory');
      const img = () =>
        document.querySelector<HTMLImageElement>(`#screen-bag [data-slot="${slot}"] img`);
      await waitForSlot('bag', slot);
      // The icons are drawn once for the page, in the background; the screen shows them on a
      // later refresh, once they are there.
      const loaded = () => (img()?.complete ?? false) && img()!.naturalWidth > 0;
      assert(await withinFrames(ICON_FRAMES, loaded), `no icon in slot ${slot}`);
      const icon = img()!;
      assert(icon.naturalWidth === 32, `the icon is ${icon.naturalWidth} pixels wide`);
      const def = app.registry!.pack.textures.find((t) => t.key === fruit.icon);
      assert(def?.mask, 'the icon is not drawn from a grid');
      const palette = new Set(def.palette);
      const stray = [...colours(icon)].filter((c) => !palette.has(c));
      assert(stray.length === 0, `colours off its palette: ${stray.slice(0, 4).join(', ')}`);
    } finally {
      app.inventory!.closeScreen();
      const stack = inventory[slot];
      if (stack && stack.count > 1) stack.count--;
      else inventory[slot] = null;
    }
  },
};

export const M49_SUITE: readonly SelftestCase[] = [
  iconCase,
  noErrorsCase('no errors after the m49 checks'),
];
