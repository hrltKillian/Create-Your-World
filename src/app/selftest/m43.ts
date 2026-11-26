import { openBag } from './screenSteps.ts';
import {
  assert,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
} from './support.ts';

/*
 * M43 the colony's interface (plan v4 « M43 »; its look since plan v5 « M48 »), on the flat world
 * with fixed steps (?worldType=flat&fixedStep=1): the Bag and the hotbar are riveted painted
 * plates (pixel art, no blur: a blur would hold the bubble), their slots sockets pressed in (the
 * HUD's layout is m35's).
 */

/** Whether a computed background draws the code's pixel art. */
const pixelArt = (background: string) => background.includes('data:image/png');

const themeCase: SelftestCase = {
  name: 'the Bag and the hotbar are riveted painted plates, unblurred, their slots pressed in',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    await playerSession(app);
    openBag(app, 'inventory');
    try {
      const panel = document.querySelector<HTMLElement>('#screen-bag .bag-panel');
      assert(panel, 'no Bag panel');
      const style = getComputedStyle(panel);
      assert(style.backdropFilter === 'none', `the Bag's backdrop is ${style.backdropFilter}`);
      assert(pixelArt(style.backgroundImage), "the Bag's plate is not the code's pixel art");
      const hotbar = document.querySelector<HTMLElement>('.hotbar');
      assert(
        hotbar && pixelArt(getComputedStyle(hotbar).backgroundImage),
        'the hotbar is no plate',
      );
      const slot = document.querySelector<HTMLElement>('#screen-bag [data-slot="0"]');
      // A socket: its bracketed rim and recessed floor drawn as a 9-slice of the code's art.
      assert(slot && pixelArt(getComputedStyle(slot).borderImageSource), 'the slots are flat');
    } finally {
      app.inventory!.closeScreen();
    }
  },
};

export const M43_SUITE: readonly SelftestCase[] = [
  themeCase,
  noErrorsCase('no errors after the m43 checks'),
];
