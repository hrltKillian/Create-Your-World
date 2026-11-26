import { clampPitch } from '../core/angles.ts';
import type { Action } from '../input/bindings.ts';
import type { Command } from '../sim/commands.ts';
import { serializeInventory } from '../sim/inventory.ts';
import { type DayPhase, daylightAt, dayOf, hourOf, phaseOf } from '../sim/time.ts';
import type { WeatherKind } from '../sim/weather.ts';
import type { QueueView } from '../ui/screens/logbook.ts';
import { blockOf, skyOf } from '../world/light.ts';
import type { App } from './App.ts';
import type { Game } from './Game.ts';
import { queueView, stationStatus } from './UiBridge.ts';
import { frameOrFail, waitForChunks } from './waits.ts';

/**
 * Automation helpers shared by the debug hook (`window.__game`) and the in-browser selftests: the
 * debug commands, input, block keys and light, the world clock and the weather, what the hotbar
 * shows, crafting, block entities (opening one without aiming), and saving or reloading the open
 * world. The waits (waits.ts) and the clicks on the screens (screenAutomation.ts) are re-exported
 * here; the survival ones are survivalAutomation.ts's.
 */

export * from './screenAutomation.ts';
export * from './waits.ts';

/** Sends commands in order; fixed-step sessions apply them now (one tick). */
export function sendAndStep(app: App, ...commands: Command[]): void {
  const session = app.session;
  if (!session) return;
  for (const command of commands) session.host.send(command);
  if (app.params.fixedStep) session.step(1);
}

/** Teleports the player (`'surface'` lands on the ground); fixed-step sessions apply it now. */
export function teleport(app: App, x: number, y: number | 'surface', z: number): void {
  sendAndStep(app, { type: 'debug.teleport', x, y, z });
}

/** Fills a box (inclusive corners) with a block state key; fixed-step sessions apply it now. */
export function fill(
  app: App,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  state: string,
): void {
  sendAndStep(app, { type: 'debug.fill', x0, y0, z0, x1, y1, z1, state });
}

/** Sends a command and applies it now, without a tick (the clock and gauge commands). */
export function sendNow(app: App, command: Command): void {
  const session = app.session;
  if (!session) return;
  session.host.send(command);
  session.pumpOnce(false);
}

/** Sets one block from a state key (a one-block `fill`). */
export function setBlock(app: App, x: number, y: number, z: number, state: string): void {
  fill(app, x, y, z, x, y, z, state);
}

/** Text key of the block state at a position (null without a world). */
export function blockKey(app: App, x: number, y: number, z: number): string | null {
  if (!app.world || !app.registry) return null;
  return app.registry.states[app.world.getBlock(x, y, z)]?.key ?? null;
}

/** Sky and block light (0–15 each) at a position (null without a world; unloaded cells are dark). */
export function lightAt(
  app: App,
  x: number,
  y: number,
  z: number,
): { sky: number; block: number } | null {
  if (!app.world) return null;
  const packed = app.world.getLight(Math.floor(x), Math.floor(y), Math.floor(z));
  return { sky: skyOf(packed), block: blockOf(packed) };
}

/** The world clock as automation reads it. */
export interface ClockView {
  readonly ticks: number;
  /** Hour of the day, 0 ≤ hour < 24 (fractional). */
  readonly hour: number;
  /** Day number, 1 on the world's first day. */
  readonly day: number;
  readonly phase: DayPhase;
  /** Sky light factor (`uDaylight`). */
  readonly daylight: number;
  readonly frozen: boolean;
}

/** The world clock (null without a world session). */
export function clock(app: App): ClockView | null {
  const time = app.session?.host.view.time();
  if (!time) return null;
  const hour = hourOf(time.ticks);
  return {
    ticks: time.ticks,
    hour,
    day: dayOf(time.ticks),
    phase: phaseOf(hour),
    daylight: daylightAt(hour),
    frozen: time.frozen,
  };
}

/** Moves the clock to an hour (0 ≤ hours < 24) of the current day, now (`debug.setTime`). */
export function setTime(app: App, hours: number): void {
  sendNow(app, { type: 'debug.setTime', hours });
}

/**
 * The weather (plan v3 « M34 »): the simulation's kind, what falls on the player (rain, snow or
 * none) and what the client shows of it (eased: clouds, fog, flash, the sky's dim, rain, snow).
 */
export function weatherView(app: App) {
  const session = app.session;
  if (!session) return null;
  const feel = session.weather;
  return {
    kind: session.host.view.weather(),
    ...feel.state,
    rain: feel.rain,
    snow: feel.snow,
    drops: feel.drops(),
    /** A lightning bolt shows now (plan v5 « M47 »). */
    bolt: app.view?.lightning.showing() ?? false,
  };
}

/** Holds a weather for `seconds` now (`debug.setWeather`; null: back to the seed's weather). */
export function setWeather(app: App, weather: WeatherKind | null, seconds = 600): void {
  sendNow(app, { type: 'debug.setWeather', weather, seconds });
}

/** A lightning strike at the top of a column, now (`debug.strike`, plan v5 « M47 »). */
export function strike(app: App, x: number, z: number): void {
  sendNow(app, { type: 'debug.strike', x, z });
}

/** Stops or restarts the clock, now (`debug.freezeTime`). */
export function freezeTime(app: App, frozen: boolean): void {
  sendNow(app, { type: 'debug.freezeTime', frozen });
}

/** Holds an action for `ticks` ticks; fixed-step sessions also advance those ticks now. */
export function press(app: App, action: Action, ticks: number): void {
  if (!app.input || !app.session) return;
  app.input.force(action, ticks);
  if (app.params.fixedStep) app.session.step(ticks);
}

/** Gives the player items (what does not fit drops at their feet); fixed-step sessions apply it now. */
export function give(app: App, item: string, count: number): void {
  sendAndStep(app, { type: 'debug.give', item, count });
}

/**
 * Opens the chest or station of a cell as secondary on it does, without aiming (`debug.open`:
 * within 5 blocks, refused unless the world allows debugging); fixed-step sessions apply it now
 * and its screen shows at once.
 */
export function openBlock(app: App, x: number, y: number, z: number): void {
  sendAndStep(app, { type: 'debug.open', x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) });
}

/**
 * Queues `count` crafts of a recipe, as the Logbook's buttons do (a workbench recipe in the open
 * workbench's queue); fixed-step sessions apply it now.
 */
export function craft(app: App, recipe: string, count: number): void {
  sendAndStep(app, { type: 'craft.enqueue', recipe, count });
}

/** The player's craft queue as the Logbook shows it, the craft under way first (null: no player). */
export function craftQueue(app: App): QueueView[] | null {
  const session = app.session;
  if (!session) return null;
  return session.player.craft.map((entry) => queueView(session.host.view.registry, entry));
}

/**
 * What the block entity of a cell holds: a chest's slots, an Abandoned Pack's slots and worn items
 * (`worn`, head to feet), a workbench's outputs and queue (`queue`, as the Logbook shows it), or a
 * station's (inputs, fuel, outputs) with its flame, progress and process. Null when the cell has
 * none (a generated chest gets one when it is first opened, an older save's workbench too).
 */
export function blockEntityContents(app: App, x: number, y: number, z: number) {
  const view = app.session?.host.view;
  const entity = view?.blockEntity(Math.floor(x), Math.floor(y), Math.floor(z));
  if (!view || !entity) return null;
  const slots = serializeInventory(entity.slots);
  if (entity.kind === 'grave')
    return { kind: entity.kind, slots, worn: serializeInventory(entity.worn) };
  if (entity.kind === 'workbench') {
    const queue = entity.craft.map((entry) => queueView(view.registry, entry));
    return { kind: entity.kind, station: entity.station, slots, queue };
  }
  if (entity.kind !== 'station') return { kind: entity.kind, slots };
  return {
    kind: entity.kind,
    station: entity.station,
    slots,
    ...stationStatus(view.registry, entity),
  };
}

/** Sets the view angles (radians; the pitch is clamped like the mouse look). */
export function look(app: App, yaw: number, pitch: number): void {
  const rig = app.session?.rig;
  if (!rig) return;
  rig.yaw = yaw;
  rig.pitch = clampPitch(pitch);
}

/** What the hotbar shows: the selected slot and each slot's count text ('' when none). */
export function hotbarView(app: App): { selected: number; counts: string[] } | null {
  const hotbar = app.inventory?.hotbar;
  if (!hotbar) return null;
  const counts = [...hotbar.element.querySelectorAll('.slot-count')].map(
    (e) => e.textContent ?? '',
  );
  return { selected: hotbar.selected, counts };
}

/** Saves the open world now, like an autosave (deflated, one transaction); resolves with success. */
export function saveNow(app: App): Promise<boolean> {
  const saves = app.game?.open?.saves;
  return saves ? saves.save() : Promise.reject(new Error('No open world'));
}

/** Longest wait for a reopened world's loading radius to be meshed. */
const RELOAD_MS = 30_000;

/**
 * Saves and closes the open world (the pause menu's Save & quit), then opens it again from its
 * records; resolves once the loading radius around the player is meshed.
 */
export function reloadWorld(app: App): Promise<void> {
  const id = app.game?.open?.info.id;
  return reenter(app, (game) => game.openWorld(id!), `World ${id} did not open again`);
}

/**
 * Saves and closes the open world, then creates and opens a new one of the same seed (and the
 * boot's world type), as the New world screen does: a fresh player there. Resolves once its
 * loading radius is meshed.
 */
export function freshWorld(app: App): Promise<void> {
  const seed = app.session?.seed ?? '';
  return reenter(
    app,
    (game) => game.createWorld({ name: '', seed, hostiles: true }),
    `No new world of seed ${seed}`,
  );
}

/** Save & quit, then `enter` another world; resolves once its loading radius is meshed. */
async function reenter(
  app: App,
  enter: (game: Game) => Promise<void>,
  failure: string,
): Promise<void> {
  const game = app.game;
  const id = game?.open?.info.id;
  if (!game || !id) throw new Error('No open world');
  if (game.state !== 'paused') game.pause();
  if (!(await game.saveAndQuit()))
    throw new Error(`Save & quit of world ${id} failed (state ${game.state})`);
  await enter(game);
  const session = app.session;
  if (!session) throw new Error(`${failure} (state ${game.state})`);
  await waitForChunks(app, session.loadingRadius(), RELOAD_MS);
  // The frame loop leaves the loading state on its next frame (there is none in a hidden page).
  if (!document.hidden) await frameOrFail();
}
