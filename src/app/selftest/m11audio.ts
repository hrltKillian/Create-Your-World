import { ambienceKey } from '../../audio/Ambience.ts';
import { AUDIO } from '../../audio/AudioEngine.ts';
import { consumeSound } from '../../audio/cues.ts';
import type { BlockDef, ItemDef, SoundBindings } from '../../content/schema.ts';
import { HOTBAR_SLOTS, STRIDE } from '../../core/player.ts';
import { ticksOf } from '../../sim/clock.ts';
import { HOUR_TICKS } from '../../sim/time.ts';
import { ARENA_DOOR, ARENA_WORKSHOP } from '../../world/gen/arena.ts';
import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import type { App } from '../App.ts';
import { litSounds } from '../AudioBridge.ts';
import { ambienceView, audioMark, heardSince } from '../audioAutomation.ts';
import {
  craft,
  fill,
  frameOrFail,
  framesFor,
  give,
  look,
  openBlock,
  press,
  setBlock,
  setTime,
} from '../automation.ts';
import { god, setStat } from '../survivalAutomation.ts';
import {
  aimAt,
  arenaOf,
  assert,
  type Cell,
  keepingClock,
  needsArenaPlayer,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  standAt,
  stateKey,
} from './support.ts';

/**
 * M11 « audio.log() contient les sons attendus » browser checks in the arena with fixed steps
 * (?worldType=arena&fixedStep=1): after a scripted walk the log holds the ground's footstep at the
 * stride's rate (not one a tick), then a jump and its landing, a meal and a drink, a craft, a chest
 * opened and closed, the cabin door opened and closed, the dusk and dawn stingers with the night
 * and day ambience across 18:30 and 06:00, the splash, bubbles and low-pass under water, the
 * heartbeat at low health and the crackles of a lit fire. Every key comes from the pack's sound
 * bindings and items (engine code never names content). Ticks advance by `step` only, so the
 * cases interleave short steps with frames: the client hears the body once a frame.
 */

/** Open ground east of the arena's features: where each case stands. */
const WALK_FROM = { x: 22, z: 8 } as const;
const JUMP_SPOT = { x: 26, z: 0 } as const;
const MEAL_SPOT = { x: 26, z: 4 } as const;
const WATER_SPOT = { x: 30, z: 0 } as const;
const FIRE_SPOT = { x: 30, z: 6 } as const;
/** Steps of the walk, two ticks each (4 s: about 17 m at walking speed). */
const WALK_STEPS = 60;
/** Ticks for a jump to come down again. */
const JUMP_TICKS = 30;
/** Ticks a held use or a craft gets past its own duration. */
const SLACK_TICKS = 10;
/** Health under the heartbeat's threshold, and the steps (two ticks each: 3 s) it is heard for. */
const LOW_HEALTH = 10;
const BEAT_STEPS = 45;
/** Wall time for the crackles of a lit fire (a scan every 0.5 s, a crackle every 0.35–0.8 s). */
const CRACKLE_MS = 2500;

function soundsOf(app: App): SoundBindings {
  const sounds = app.registry!.pack.sounds;
  assert(sounds, 'the content pack binds no sounds');
  return sounds;
}

/** Fails unless every key was logged since the mark, in this order. */
function assertHeard(app: App, mark: number, keys: readonly string[], what: string): void {
  const heard = heardSince(app, mark);
  let from = 0;
  for (const key of keys) {
    const at = heard.indexOf(key, from);
    assert(at >= 0, `${what}: no ${key} in audio.log() (heard: ${heard.join(', ') || 'nothing'})`);
    from = at + 1;
  }
}

/**
 * `n` steps of `ticks` ticks, each heard by the client's next frame and lasting at least
 * AUDIO.dedupMs of wall time: the engine drops a key played again sooner, and fixed steps squeeze
 * the game's seconds (two footsteps 6 stepped frames apart are under 30 ms on a 240 Hz display).
 */
export async function stepFrames(app: App, n: number, ticks: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    app.session!.step(ticks);
    await framesFor(AUDIO.dedupMs);
  }
}

/** Holds secondary with an item in the hand, looking at the sky, for its eating time. */
async function consumeHeld(app: App, def: ItemDef): Promise<void> {
  give(app, def.key, 1);
  const inventory = app.session!.player.inventory;
  const slot = inventory.findIndex((stack, i) => i < HOTBAR_SLOTS && stack?.item === def.key);
  assert(slot >= 0, `${def.key} is not in the hotbar`);
  app.input!.slot = slot;
  look(app, 0, 1.2);
  await frameOrFail();
  press(app, 'secondary', ticksOf(def.consume!.seconds) + SLACK_TICKS);
  app.session!.step(2);
}

/** The first item of the pack consumed with the given sound (a drink without a container first). */
function consumable(app: App, sound: 'eat' | 'drink'): ItemDef {
  const registry = app.registry!;
  const items = registry.items.filter((d) => d.consume && consumeSound(registry, d.key) === sound);
  const def = items.find((d) => !d.container) ?? items[0];
  assert(def, `no item of the pack is consumed with the ${sound} sound`);
  return def;
}

/** The arena workshop's first block that `matches` (its cell). */
function workshopCell(app: App, matches: (def: BlockDef) => boolean): Cell {
  const registry = app.registry!;
  const i = arenaOf(app).workshop.findIndex((key) =>
    matches(registry.blockDef(registry.defaultState(key))),
  );
  assert(i >= 0, "no block of the arena's workshop fits");
  const row = ARENA_WORKSHOP;
  return { x: row.x + i * row.step, y: row.y, z: row.z };
}

/** Sets both halves of the cabin door closed, or open. */
function setDoor(app: App, open: boolean): void {
  const registry = app.registry!;
  for (const y of [ARENA_DOOR.y, ARENA_DOOR.y + 1]) {
    const state = app.world!.getBlock(ARENA_DOOR.x, y, ARENA_DOOR.z);
    const next = registry.withState(state, 'open', open ? '1' : '0');
    setBlock(app, ARENA_DOOR.x, y, ARENA_DOOR.z, stateKey(app, next));
  }
}

/** Secondary on the cabin door from outside; returns its lower half's `open` value after. */
async function useDoor(app: App): Promise<string | undefined> {
  await standAt(app, { x: ARENA_DOOR.x, z: ARENA_DOOR.z + 1 });
  await aimAt(app, ARENA_DOOR);
  press(app, 'secondary', 1);
  app.session!.step(2);
  const { x, y, z } = ARENA_DOOR;
  return app.registry!.prop(app.world!.getBlock(x, y, z), 'open');
}

/** The ambience loop of the place last heard, by night or by day; fails without a place. */
function placeLoop(app: App, night: boolean): string {
  const place = ambienceView(app)?.place;
  assert(place, 'the ambience heard no place');
  return ambienceKey(soundsOf(app).ambience, { ...place, night });
}

/** Fails unless the ambience plays (or fades in) `key`. */
function assertLoop(app: App, key: string, what: string): void {
  const loops = ambienceView(app)?.loops ?? [];
  const playing = loops.map((l) => `${l.key} ${l.gain.toFixed(2)}`).join(', ') || 'nothing';
  assert(
    loops.some((l) => l.key === key && l.gain > 0),
    `${what}: the ambience plays ${playing}, not ${key}`,
  );
}

export const M11_AUDIO_CASES: readonly SelftestCase[] = [
  {
    name: 'a walk on the grass logs its footstep once a stride, not once a tick',
    scenes: PLAY_SCENES,
    skip: needsArenaPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const body = session.player.body;
      await standAt(app, WALK_FROM);
      look(app, 0, 0);
      const step = app.registry!.blockSfx(
        app.world!.getBlock(WALK_FROM.x, FLAT_SURFACE, WALK_FROM.z),
        'step',
      );
      assert(step, 'the ground has no footstep sound');
      const mark = audioMark(app);
      const from = body.z;
      app.input!.force('forward', WALK_STEPS * 2);
      await stepFrames(app, WALK_STEPS, 2);
      const strides = Math.floor((from - body.z) / STRIDE);
      const steps = heardSince(app, mark).filter((key) => key === step).length;
      assert(strides >= 5, `the walk covered ${(from - body.z).toFixed(1)} m only`);
      assert(
        Math.abs(steps - strides) <= 1,
        `${steps} footsteps (${step}) over ${strides} strides of ${STRIDE} m`,
      );
    },
  },
  {
    name: 'a jump logs the jump, then its landing',
    scenes: PLAY_SCENES,
    skip: needsArenaPlayer,
    run: async (app) => {
      await playerSession(app);
      await standAt(app, JUMP_SPOT);
      const mark = audioMark(app);
      press(app, 'jump', 1);
      app.session!.step(JUMP_TICKS);
      const { jump, land } = soundsOf(app).player;
      assertHeard(app, mark, [jump, land], 'the jump');
    },
  },
  {
    name: 'eating and drinking held items log their eat and drink sounds',
    scenes: PLAY_SCENES,
    skip: needsArenaPlayer,
    run: async (app) => {
      await playerSession(app);
      await standAt(app, MEAL_SPOT);
      const b = app.registry!.pack.balance;
      setStat(app, 'hunger', b.hunger.max / 2);
      setStat(app, 'thirst', b.thirst.max / 2);
      const mark = audioMark(app);
      await consumeHeld(app, consumable(app, 'eat'));
      await consumeHeld(app, consumable(app, 'drink'));
      const { eat, drink } = soundsOf(app).player;
      assertHeard(app, mark, [eat, drink], 'the meal');
    },
  },
  {
    name: 'a craft done logs the craft sound',
    scenes: PLAY_SCENES,
    skip: needsArenaPlayer,
    run: async (app) => {
      await playerSession(app);
      const registry = app.registry!;
      // The quickest hand recipe known from the start whose ingredients are items (not tags).
      const recipe = registry.crafting.recipes
        .filter(
          (r) => r.known === 'start' && !r.station && r.inputs.every((i) => registry.item(i.item)),
        )
        .sort((a, b) => a.seconds - b.seconds)[0];
      assert(recipe, 'no hand recipe known from the start takes items only');
      for (const input of recipe.inputs) give(app, input.item, input.count);
      const mark = audioMark(app);
      craft(app, recipe.key, 1);
      app.session!.step(ticksOf(recipe.seconds) + SLACK_TICKS);
      assertHeard(app, mark, [soundsOf(app).craft], `crafting ${recipe.key}`);
    },
  },
  {
    name: "the workshop's chest logs its opening and its closing",
    scenes: PLAY_SCENES,
    skip: needsArenaPlayer,
    run: async (app) => {
      await playerSession(app);
      const chest = workshopCell(app, (def) => def.blockEntity === 'container');
      await standAt(app, { x: chest.x, z: chest.z + 2 });
      const mark = audioMark(app);
      try {
        openBlock(app, chest.x, chest.y, chest.z);
        assert(app.inventory?.screen() === 'container', 'the chest screen did not open');
      } finally {
        app.inventory?.closeScreen();
        app.session!.step(1);
      }
      const { open, close } = soundsOf(app).chest;
      assertHeard(app, mark, [open, close], 'the chest');
    },
  },
  {
    name: 'the cabin door logs its own opening and closing sounds',
    scenes: PLAY_SCENES,
    skip: needsArenaPlayer,
    run: async (app) => {
      await playerSession(app);
      setDoor(app, false);
      const mark = audioMark(app);
      try {
        assert((await useDoor(app)) === '1', 'secondary did not open the door');
        assert((await useDoor(app)) === '0', 'secondary did not close the door');
      } finally {
        setDoor(app, false);
      }
      const { open, close } = soundsOf(app).door;
      assertHeard(app, mark, [open, close], 'the door');
    },
  },
  {
    name: 'across 18:30 and 06:00 the stingers sound and the ambience turns to night and back',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsArenaPlayer,
    run: async (app) => {
      await playerSession(app);
      await standAt(app, JUMP_SPOT);
      const { dusk, dawn } = soundsOf(app).clock;
      god(app, true);
      try {
        await keepingClock(app, async () => {
          const mark = audioMark(app);
          // Half an hour of ticks from 18:15 passes 18:30; the frames hear the night.
          setTime(app, 18.25);
          await stepFrames(app, 2, HOUR_TICKS / 2);
          assertHeard(app, mark, [dusk], 'the sunset');
          assertLoop(app, placeLoop(app, true), 'at dusk');
          // Past midnight (a night is survived from the second day on), then past 06:00.
          setTime(app, 23.75);
          app.session!.step(HOUR_TICKS / 2);
          setTime(app, 5.75);
          await stepFrames(app, 2, HOUR_TICKS / 2);
          assertHeard(app, mark, [dusk, dawn], 'the night survived');
          assertLoop(app, placeLoop(app, false), 'in the morning');
        });
      } finally {
        god(app, false);
      }
    },
  },
  {
    name: 'under water the low-pass closes, the splash sounds and the bubbles loop plays',
    scenes: PLAY_SCENES,
    skip: needsArenaPlayer,
    run: async (app) => {
      await playerSession(app);
      await standAt(app, WATER_SPOT);
      const water = stateKey(app, app.registry!.defaultState(arenaOf(app).pond.liquid));
      const air = stateKey(app, app.registry!.air);
      const { x, z } = WATER_SPOT;
      const [y0, y1] = [FLAT_SURFACE + 1, FLAT_SURFACE + 3];
      const sounds = soundsOf(app);
      const mark = audioMark(app);
      try {
        fill(app, x - 1, y0, z - 1, x + 1, y1, z + 1, water);
        await stepFrames(app, 3, 2);
        assert(ambienceView(app)?.underwater, 'the camera in water did not close the low-pass');
        assertHeard(app, mark, [sounds.player.splash], 'going into water');
        assertLoop(app, sounds.ambience.underwater, 'under water');
      } finally {
        fill(app, x - 1, y0, z - 1, x + 1, y1, z + 1, air);
        await stepFrames(app, 2, 2);
      }
      assert(!ambienceView(app)?.underwater, 'the low-pass stayed closed out of the water');
    },
  },
  {
    name: 'the heart beats at low health',
    scenes: PLAY_SCENES,
    skip: needsArenaPlayer,
    run: async (app) => {
      await playerSession(app);
      const b = app.registry!.pack.balance.health;
      assert(LOW_HEALTH < b.lowAt, `health ${LOW_HEALTH} is not under ${b.lowAt}`);
      const beat = soundsOf(app).player.heartbeat;
      const mark = audioMark(app);
      try {
        setStat(app, 'health', LOW_HEALTH);
        await stepFrames(app, BEAT_STEPS, 2);
      } finally {
        setStat(app, 'health', b.max);
      }
      const beats = heardSince(app, mark).filter((key) => key === beat).length;
      // Three seconds of ticks, a beat every second at most.
      assert(beats >= 3, `${beats} heartbeats (${beat}) in 3 s at health ${LOW_HEALTH}`);
    },
  },
  {
    name: 'a lit fire near the player crackles',
    scenes: PLAY_SCENES,
    timeoutMs: 20_000,
    skip: needsArenaPlayer,
    run: async (app) => {
      await playerSession(app);
      const registry = app.registry!;
      const keys: string[] = [];
      const table = litSounds(registry, keys);
      const lit = table.findIndex((sound) => sound >= 0);
      assert(lit >= 0, 'no lit station block has a sound');
      const { x, z } = FIRE_SPOT;
      const y = FLAT_SURFACE + 1;
      await standAt(app, { x, z: z + 2 });
      const mark = audioMark(app);
      try {
        setBlock(app, x, y, z, stateKey(app, lit));
        await framesFor(CRACKLE_MS);
      } finally {
        setBlock(app, x, y, z, stateKey(app, registry.air));
      }
      assertHeard(app, mark, [keys[table[lit]!]!], `the lit ${stateKey(app, lit)}`);
    },
  },
];
