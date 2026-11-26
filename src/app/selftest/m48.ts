import { withinFrames } from '../automation.ts';
import { setStat } from '../survivalAutomation.ts';
import { openBag } from './screenSteps.ts';
import {
  assert,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  UI_FRAMES,
} from './support.ts';

/*
 * M48 the « collapsed colony » interface (plan v5 « M48 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): the typeface, the gauges' pixel-art symbols full and empty, the
 * temperature dial's needle, the panels' vine and moss.
 */

/** Whether a computed background draws the code's pixel art. */
const pixelArt = (background: string) => background.includes('data:image/png');

const typefaceCase: SelftestCase = {
  name: 'the interface speaks in its own typeface',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    await playerSession(app);
    await document.fonts.ready;
    assert(document.fonts.check('16px "Barlow Semi Condensed"'), 'the typeface did not load');
    const family = getComputedStyle(document.body).fontFamily;
    assert(family.startsWith('"Barlow Semi Condensed"'), `the body speaks in ${family}`);
  },
};

const gaugesCase: SelftestCase = {
  name: 'the gauges are pixel-art symbols, full over empty; the dial’s needle turns with the cold',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    await playerSession(app);
    for (const row of ['health', 'hunger', 'thirst']) {
      const icon = document.querySelector<HTMLElement>(`#hud-vitals .row-${row} .stat-icon`);
      assert(icon, `no ${row} symbol`);
      assert(pixelArt(getComputedStyle(icon).backgroundImage), `the empty ${row} symbol is no art`);
      const full = getComputedStyle(icon, '::before').backgroundImage;
      assert(pixelArt(full), `the full ${row} symbol is no art`);
    }
    const needle = () =>
      getComputedStyle(document.querySelector('.thermo-bulb')!, '::after').transform;
    const limit = app.registry!.pack.balance.temperature.limit;
    setStat(app, 'temperature', -limit);
    await withinFrames(UI_FRAMES, () => false);
    const cold = needle();
    setStat(app, 'temperature', limit);
    assert(
      await withinFrames(UI_FRAMES, () => needle() !== cold),
      'the dial’s needle stayed still',
    );
    setStat(app, 'temperature', 0);
  },
};

const panelsCase: SelftestCase = {
  name: 'the panels are overgrown: a vine over a corner, moss along the foot',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    await playerSession(app);
    openBag(app, 'inventory');
    try {
      const panel = document.querySelector<HTMLElement>('#screen-bag .bag-panel')!;
      assert(pixelArt(getComputedStyle(panel, '::before').backgroundImage), 'no vine');
      assert(pixelArt(getComputedStyle(panel, '::after').backgroundImage), 'no moss');
    } finally {
      app.inventory!.closeScreen();
    }
  },
};

export const M48_SUITE: readonly SelftestCase[] = [
  typefaceCase,
  gaugesCase,
  panelsCase,
  noErrorsCase('no errors after the m48 checks'),
];
