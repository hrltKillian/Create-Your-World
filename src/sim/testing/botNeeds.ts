import { clampPitch, yawOf } from '../../core/angles.ts';
import { HOTBAR_SLOTS } from '../../core/player.ts';
import type { Rng } from '../../core/rng.ts';
import type { Command } from '../commands.ts';
import { INVENTORY_SLOTS } from '../inventory.ts';
import { eyeHeight } from '../physics.ts';
import type { PlayerState } from '../player.ts';
import {
  BLOCK,
  type BotSenses,
  BUSH,
  DRINK,
  emptySlot,
  FOOD,
  handSlot,
  kindOf,
  lastSlotWithout,
  nearestSource,
  slotWith,
  sourceAt,
  TOOL,
  TOXIC,
  WATER,
} from './botSenses.ts';
import {
  type BotState,
  begin,
  FORWARD,
  JUMP,
  JUMP_AFTER,
  PRIMARY,
  SECONDARY,
  startWalk,
} from './botState.ts';

/*
 * How the wanderMineBuild bot looks after itself: it eats and drinks what it carries when a gauge
 * runs low, walks to water or to a food plant when it carries nothing (roaming away when none is
 * near), and keeps one hotbar slot empty for the bare hand that sips.
 */

/** Gauges below which the bot looks after itself, and where it stops eating or drinking. */
const THIRSTY = 55;
const QUENCHED = 92;
const HUNGRY = 50;
const FED = 90;
/** From this toxicity on, the bot eats and drinks nothing poisonous. */
const TOXIC_LIMIT = 40;
/** Ticks between two searches for a source, and the longest a search or a meal goes on. */
const RESCAN_TICKS = 90;
const SEEK_TICKS = 600;
const EAT_TICKS = 300;
/** Ticks of walking onwards when a search found nothing (towards the roaming direction). */
const ROAM_TICKS = 240;
/** Ticks before a search that did not get there is tried again. */
const RETRY_TICKS = 360;
/** Horizontal distance (m) from a target cell's centre where the bot stops walking and acts. */
const CLOSE = 1.5;
/** Eating looks up (radians), so the use button reaches no block. */
const SKY = 0.7;

/**
 * At most one inventory command: a full hotbar sends the stack it needs least to the bag (or
 * throws it when the bag is full too), so the bare hand can sip; food or drink kept in the bag
 * comes to the hotbar when the bot needs it.
 */
export function tidy(senses: BotSenses, player: Readonly<PlayerState>): Command | null {
  const inventory = player.inventory;
  if (emptySlot(inventory, 0, HOTBAR_SLOTS) < 0) {
    let slot = lastSlotWithout(senses, inventory, FOOD | DRINK | BLOCK | TOOL);
    if (slot < 0) slot = lastSlotWithout(senses, inventory, FOOD | DRINK);
    if (slot < 0) slot = HOTBAR_SLOTS - 1;
    return emptySlot(inventory, HOTBAR_SLOTS, INVENTORY_SLOTS) >= 0
      ? { type: 'inv.quickMove', slot }
      : { type: 'inv.drop', slot, all: true };
  }
  const sv = player.survival;
  return (
    (sv.thirst < THIRSTY ? fetch(senses, player, DRINK) : null) ??
    (sv.hunger < HUNGRY ? fetch(senses, player, FOOD) : null)
  );
}

/** Moves a stack of a kind from the bag to the hotbar when the hotbar has none. */
function fetch(senses: BotSenses, player: Readonly<PlayerState>, kind: number): Command | null {
  const inventory = player.inventory;
  if (slotWith(senses, inventory, kind, 0) >= 0) return null;
  const slot = slotWith(senses, inventory, kind, 0, HOTBAR_SLOTS, INVENTORY_SLOTS);
  return slot < 0 ? null : { type: 'inv.quickMove', slot };
}

/** Thirst first, then hunger: starts a meal, a search or a roam; false when there is nothing to do. */
export function takeCare(
  s: BotState,
  senses: BotSenses,
  player: Readonly<PlayerState>,
  tick: number,
): boolean {
  const sv = player.survival;
  return (
    (sv.thirst < THIRSTY && care(s, senses, player, tick, DRINK, WATER)) ||
    (sv.hunger < HUNGRY && care(s, senses, player, tick, FOOD, BUSH))
  );
}

/**
 * Eats or drinks an item of `kind` from the hotbar. With none in the whole inventory (tidying
 * brings those of the bag), a search every RESCAN_TICKS walks to the nearest `source` block, or
 * roams onwards when there is none in sight.
 */
function care(
  s: BotState,
  senses: BotSenses,
  player: Readonly<PlayerState>,
  tick: number,
  kind: number,
  source: number,
): boolean {
  const inventory = player.inventory;
  const avoid = player.survival.toxicity >= TOXIC_LIMIT ? TOXIC : 0;
  const slot = slotWith(senses, inventory, kind, avoid);
  if (slot >= 0) {
    begin(s, 'eat', tick, EAT_TICKS);
    s.want = kind;
    s.slot = slot;
    s.pitch = SKY;
    return true;
  }
  if (slotWith(senses, inventory, kind, avoid, HOTBAR_SLOTS, INVENTORY_SLOTS) >= 0) return false;
  if (tick < s.scanAt[source]!) return false;
  s.scanAt[source] = tick + RESCAN_TICKS;
  if (!nearestSource(senses, source, player.body, s)) {
    startWalk(s, tick, s.roam, ROAM_TICKS);
    return true;
  }
  begin(s, 'seek', tick, SEEK_TICKS);
  s.want = source;
  s.close = false;
  return true;
}

/** Whether a meal or a search is over before its time: fed, quenched, eaten up, the source gone. */
export function needMet(s: BotState, senses: BotSenses, player: Readonly<PlayerState>): boolean {
  const sv = player.survival;
  if (s.task === 'eat') {
    const gauge = s.want === DRINK ? sv.thirst >= QUENCHED : sv.hunger >= FED;
    return gauge || (kindOf(senses, player.inventory[s.slot]!) & s.want) === 0;
  }
  if (s.task !== 'seek') return false;
  if (sourceAt(senses, s.tx, s.ty, s.tz) !== s.want) return true;
  return s.want === WATER && sv.thirst >= QUENCHED;
}

/** A search that does not get there: none for RETRY_TICKS, roaming a new way meanwhile. */
export function giveUp(s: BotState, rng: Rng, tick: number): void {
  s.scanAt[s.want] = tick + RETRY_TICKS;
  s.roam = rng.range(-Math.PI, Math.PI);
  startWalk(s, tick, s.roam, ROAM_TICKS);
}

/**
 * One tick of a search: walks to the target cell (jumping when blocked or swimming), then looks
 * at it: sips water with the bare hand, mines a food plant.
 */
export function seek(
  s: BotState,
  senses: BotSenses,
  player: Readonly<PlayerState>,
  tick: number,
): number {
  const b = player.body;
  const dx = s.tx + 0.5 - b.x;
  const dz = s.tz + 0.5 - b.z;
  const flat = Math.sqrt(dx * dx + dz * dz);
  s.yaw = yawOf(dx, dz);
  if (flat > CLOSE && !(s.want === WATER && b.inWater)) {
    s.close = false;
    s.pitch = 0;
    return FORWARD | (s.stuck > JUMP_AFTER || b.inWater ? JUMP : 0);
  }
  if (!s.close) {
    // The use button goes down on the next tick: a press.
    s.close = true;
    s.start = tick;
  }
  s.pitch = clampPitch(Math.atan2(s.ty + 0.5 - (b.y + eyeHeight(b)), flat));
  if (s.want === BUSH) {
    s.slot = handSlot(senses, player.inventory, s.slot);
    return PRIMARY;
  }
  const hand = emptySlot(player.inventory, 0, HOTBAR_SLOTS);
  if (hand >= 0) s.slot = hand;
  return SECONDARY;
}
