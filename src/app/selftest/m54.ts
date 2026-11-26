import { variantsOf } from '../../audio/AudioEngine.ts';
import { CREATURE_SOUNDS } from '../../content/schema.ts';
import { audioMark, heardSince } from '../audioAutomation.ts';
import { frameOrFail, strike, withinFrames } from '../automation.ts';
import {
  assert,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  standAt,
} from './support.ts';

/*
 * M54 every sound remade (plan v5 « M54 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): every recipe of the pack renders and plays in the browser, each
 * one-shot in all its takes; the interface sounds each screen opening and closing; the thunder
 * comes after the bolt's light; every species has all its sounds.
 */

const SPOT = { x: 40, z: -40 };

const everyCase: SelftestCase = {
  name: 'every sound renders and plays, each one-shot in all its takes',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  timeoutMs: 120_000,
  run: async (app) => {
    await playerSession(app);
    const audio = app.audio!;
    const recipes = app.registry!.pack.sfx ?? [];
    let played = 0;
    for (const def of recipes) {
      // Checked at once: the log keeps the last few hundred sounds only.
      const mark = audioMark(app);
      if (def.loop) {
        // A bed: asked for (the place's own may already be playing; its gain is put back).
        const was = audio.ambience().find((l) => l.key === def.key)?.gain ?? 0;
        audio.setLoop(def.key, 1);
        assert(
          audio.ambience().some((l) => l.key === def.key),
          `${def.key} does not loop`,
        );
        audio.setLoop(def.key, was);
        continue;
      }
      for (let v = 0; v < variantsOf(def); v++)
        assert(audio.playVariant(def.key, v), `${def.key} does not play`);
      assert(heardSince(app, mark).includes(def.key), `${def.key} was not heard`);
      played++;
      if (played % 10 === 0) await frameOrFail();
    }
  },
};

const screensCase: SelftestCase = {
  name: 'the Bag and the map sound as they open and close, each its own',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    await standAt(app, SPOT);
    const ui = app.registry!.pack.sounds!.ui;
    const screens = app.inventory!;
    screens.closeScreen();
    session.step(1);
    for (const [open, close, name] of [
      [() => screens.toggleBag(), () => screens.closeScreen(), 'bag'],
      [() => screens.toggleMap(), () => screens.toggleMap(), 'map'],
    ] as const) {
      const mark = audioMark(app);
      assert(open(), `the ${name} did not open`);
      await frameOrFail();
      close();
      session.step(1);
      await frameOrFail();
      const heard = heardSince(app, mark);
      const sounds = ui[name];
      assert(
        heard.includes(sounds.open),
        `the ${name} opened without its sound: ${heard.join(' ')}`,
      );
      assert(
        heard.includes(sounds.close),
        `the ${name} closed without its sound: ${heard.join(' ')}`,
      );
      assert(sounds.open !== sounds.close, `the ${name} opens and closes with one sound`);
    }
  },
};

const thunderCase: SelftestCase = {
  name: 'a bolt’s thunder comes after its light, the later the farther',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    await standAt(app, SPOT);
    const thunder = app.registry!.pack.sounds!.thunder!;
    const b = session.player.body;
    const mark = audioMark(app);
    strike(app, Math.floor(b.x) + 150, Math.floor(b.z));
    session.step(1);
    await frameOrFail();
    assert(!heardSince(app, mark).includes(thunder.far), 'the thunder came with the light');
    // 150 blocks at 340 a second: under half a second later, far off: the rumble.
    const came = await withinFrames(120, () => heardSince(app, mark).includes(thunder.far));
    assert(came, 'no rumble after the bolt');
  },
};

const speciesCase: SelftestCase = {
  name: 'every species has its voices and its steps',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const registry = app.registry!;
    const keys = new Set((registry.pack.sfx ?? []).map((d) => d.key as string));
    for (const def of registry.pack.creatures ?? [])
      for (const sound of CREATURE_SOUNDS) {
        if (sound === 'attack' && !def.attack) continue;
        const key = def.sounds[sound];
        assert(key && keys.has(key), `${def.key} has no ${sound} sound`);
      }
  },
};

export const M54_SUITE: readonly SelftestCase[] = [
  everyCase,
  screensCase,
  thunderCase,
  speciesCase,
  noErrorsCase('no errors after the m54 checks'),
];
