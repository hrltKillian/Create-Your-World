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
 * M43 the colony's interface (plan v4 « M43 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): the Bag is a pane of smoked glass with Veyra's teal rim, the
 * hotbar a glass tray, and the slots pressed into them (the HUD's layout is m35's).
 */

/** Whether a computed box shadow holds Veyra's teal rim. */
const teal = (shadow: string) => shadow.includes('127, 224, 200');

const themeCase: SelftestCase = {
  name: 'the Bag and the hotbar are smoked glass with a teal rim, their slots pressed in',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    await playerSession(app);
    openBag(app, 'inventory');
    try {
      const panel = document.querySelector<HTMLElement>('#screen-bag .bag-panel');
      assert(panel, 'no Bag panel');
      const style = getComputedStyle(panel);
      assert(
        style.backdropFilter.includes('blur'),
        `the Bag's backdrop is ${style.backdropFilter}`,
      );
      assert(teal(style.boxShadow), `the Bag's rim is ${style.boxShadow}`);
      const hotbar = document.querySelector<HTMLElement>('.hotbar');
      assert(hotbar && teal(getComputedStyle(hotbar).boxShadow), 'the hotbar has no teal rim');
      const slot = document.querySelector<HTMLElement>('#screen-bag [data-slot="0"]');
      assert(slot && getComputedStyle(slot).boxShadow.includes('inset'), 'the slots are flat');
    } finally {
      app.inventory!.closeScreen();
    }
  },
};

export const M43_SUITE: readonly SelftestCase[] = [
  themeCase,
  noErrorsCase('no errors after the m43 checks'),
];
