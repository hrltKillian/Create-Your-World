import { frameOrFail, withinFrames } from '../automation.ts';
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
 * M51 the crash survivor (plan v5 « M51 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): the avatar is the survivor, its skins at the world's density with
 * faces of their own; seen from behind and from in front the views differ (its pack, its face);
 * the Bag shows its figure.
 */

/** Frames the page gets to draw the icons and the figure, and the Bag to show it. */
const FIGURE_FRAMES = 600;

const viewsCase: SelftestCase = {
  name: 'the survivor is drawn from behind and in front, a face of its own on each side',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const registry = app.registry!;
    const model = registry.model(registry.pack.manifest.bindings.avatarModel!);
    assert(model?.pixels, 'the avatar has no skins at the world’s density');
    const head = model.parts.find((p) => p.name === 'head');
    assert(head?.faces?.front && head.faces.back, 'the head has no face of its own');
    const rig = session.rig;
    try {
      const look = async (mode: 'back' | 'front') => {
        rig.mode = mode;
        await frameOrFail();
        await frameOrFail();
        return app.view!.capture();
      };
      const back = await look('back');
      const front = await look('front');
      assert(back.hash !== front.hash, 'behind and in front look the same');
      assert(front.uniqueColors > 40, `only ${front.uniqueColors} colours in front`);
    } finally {
      rig.mode = 'first';
    }
  },
};

const figureCase: SelftestCase = {
  name: 'the Bag shows the survivor’s figure, drawn from its own skins',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  timeoutMs: 60_000,
  run: async (app) => {
    await playerSession(app);
    try {
      openBag(app, 'inventory');
      const img = () => document.querySelector<HTMLImageElement>('#screen-bag .figure-art');
      const shown = () => !!img() && !img()!.hidden && img()!.complete && img()!.naturalWidth > 0;
      assert(await withinFrames(FIGURE_FRAMES, shown), 'no figure in the Bag');
      const figure = img()!;
      // Two texels a unit: as tall as the model, about twice as tall as wide.
      assert(
        figure.naturalHeight > figure.naturalWidth * 1.8,
        `the figure is ${figure.naturalWidth} × ${figure.naturalHeight}`,
      );
    } finally {
      app.inventory!.closeScreen();
    }
  },
};

export const M51_SUITE: readonly SelftestCase[] = [
  viewsCase,
  figureCase,
  noErrorsCase('no errors after the m51 checks'),
];
