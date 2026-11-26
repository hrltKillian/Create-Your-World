import { PITCH_LIMIT } from '../../core/angles.ts';
import { Rng } from '../../core/rng.ts';
import type { PlayerState } from '../player.ts';
import { giveUp, needMet, seek, takeCare, tidy } from './botNeeds.ts';
import {
  BLOCK,
  type BotSenses,
  BUSH,
  botSenses,
  DRINK,
  FOOD,
  handSlot,
  headroom,
  slotWith,
  walledIn,
  wayAhead,
} from './botSenses.ts';
import {
  BACK,
  type BotState,
  begin,
  CROUCH,
  FORWARD,
  input,
  JUMP,
  JUMP_AFTER,
  newBotState,
  PRIMARY,
  SECONDARY,
  SPRINT,
  startWalk,
} from './botState.ts';
import type { Bot, BotWorld } from './bots.ts';

/*
 * The wanderMineBuild bot (docs « Vérification »): it wanders, mines what it aims at (the
 * simulation casts its own ray when the input has no client target) and walks onto the drops,
 * builds with the blocks of its hotbar, jumps over obstacles, climbs walls and pits by placing
 * blocks under its feet or digs its way through, swims up, and looks after its hunger and thirst
 * (botNeeds.ts). Every choice comes from its own seeded random stream and the simulation's
 * state, so two runs give the same hash.
 */

/** Ticks of walking onto what was just mined or dug, to pick up its drops. */
const COLLECT_TICKS = 25;
/**
 * A walk or a search covers PROGRESS_M (Manhattan, on the ground plane) every PROGRESS_TICKS, or
 * the bot is blocked: it climbs, digs or turns away (a search gives up for a while).
 */
const PROGRESS_TICKS = 45;
const PROGRESS_M = 1;
/** Share of the times a stuck bot with blocks climbs instead of turning away (always in a pit). */
const CLIMB_CHANCE = 0.5;
/** Share of the other times a stuck walk digs its way ahead, and the longest dig (two stones). */
const DIG_CHANCE = 0.5;
const DIG_TICKS = 300;
/** View pitches (radians) of mining: straight down, the ground just ahead, the ground further. */
const DIG_DOWN = -1.45;
const GROUND_AHEAD = -0.75;
const AHEAD = -0.4;

export function wanderMineBuildBot(seed: string, world: BotWorld): Bot {
  const rng = Rng.fromSeed(seed, 'bot:wanderMineBuild');
  const senses = botSenses(world);
  const s = newBotState(rng.range(-Math.PI, Math.PI));
  return {
    next(player, tick, out) {
      if (player.survival.dead) {
        // Starts over after the respawn, roaming elsewhere.
        begin(s, 'walk', tick, 0);
        s.roam = rng.range(-Math.PI, Math.PI);
        out.push(input(s, tick, 0));
        return;
      }
      tidy(senses, player, out);
      const b = player.body;
      s.stuck = Math.abs(b.x - s.lastX) + Math.abs(b.z - s.lastZ) < 0.02 ? s.stuck + 1 : 0;
      s.lastX = b.x;
      s.lastZ = b.z;
      checkProgress(s, rng, senses, player, tick);
      // Needs interrupt wandering, mining and building, not a meal, a search or a way out.
      const busy = s.task === 'eat' || s.task === 'seek' || s.task === 'dig';
      const cared = !busy && takeCare(s, senses, player, tick);
      if (!cared) moveOn(s, rng, senses, player, tick);
      // Whatever the task, a head under water swims up.
      const swim = b.headInWater ? JUMP : 0;
      out.push(input(s, tick, act(s, rng, senses, player, tick) | swim));
    },
  };
}

/** At the end of each progress window of a walk or a search: blocked, the bot gets unstuck. */
function checkProgress(
  s: BotState,
  rng: Rng,
  senses: BotSenses,
  player: Readonly<PlayerState>,
  tick: number,
): void {
  const b = player.body;
  const moving = (s.task === 'walk' || (s.task === 'seek' && !s.close)) && s.climb === 0;
  if (moving && tick < s.checkAt) return;
  if (moving && Math.abs(b.x - s.checkX) + Math.abs(b.z - s.checkZ) < PROGRESS_M)
    unstick(s, rng, senses, player, tick);
  // Not moving (or a window done): the next window starts here.
  s.checkAt = tick + PROGRESS_TICKS;
  s.checkX = b.x;
  s.checkZ = b.z;
}

/**
 * Blocked while walking or seeking: climbs (always in a pit, else half the time) when the hotbar
 * holds a block and no ceiling is in the way, else a search gives up for a while and a walk digs
 * its way ahead or turns away (and roams that way from now on).
 */
function unstick(
  s: BotState,
  rng: Rng,
  senses: BotSenses,
  player: Readonly<PlayerState>,
  tick: number,
): void {
  const b = player.body;
  const slot = slotWith(senses, player.inventory, BLOCK, FOOD | DRINK);
  if (slot >= 0 && headroom(senses, b) && (walledIn(senses, b) || rng.chance(CLIMB_CHANCE))) {
    s.climb = rng.intRange(20, 45);
    s.slot = slot;
  } else if (s.task === 'seek') giveUp(s, rng, tick);
  else if (rng.chance(DIG_CHANCE)) {
    begin(s, 'dig', tick, DIG_TICKS);
    s.pitch = GROUND_AHEAD;
    s.slot = handSlot(senses, player.inventory, s.slot);
  } else {
    s.yaw = rng.range(-Math.PI, Math.PI);
    s.roam = s.yaw;
  }
}

/**
 * Ends the task when it is done (the next one starts: a meal or a search met the need, a dig
 * opened the way) or out of time (a search gives up).
 */
function moveOn(
  s: BotState,
  rng: Rng,
  senses: BotSenses,
  player: Readonly<PlayerState>,
  tick: number,
): void {
  const dug = s.task === 'dig' && wayAhead(senses, player.body, s.yaw);
  if (dug || needMet(s, senses, player)) chooseNext(s, rng, senses, player, tick);
  else if (tick >= s.until && s.task === 'seek') giveUp(s, rng, tick);
  else if (tick >= s.until) chooseNext(s, rng, senses, player, tick);
}

/**
 * The next task: walking onto what was just mined or dug (its drops, the way out), else walking
 * (40 %), mining (35 %) or building (25 %, with a block in the hotbar; else mining).
 */
function chooseNext(
  s: BotState,
  rng: Rng,
  senses: BotSenses,
  player: Readonly<PlayerState>,
  tick: number,
): void {
  if (s.task === 'mine' || s.task === 'dig' || (s.task === 'seek' && s.want === BUSH)) {
    startWalk(s, tick, s.yaw, COLLECT_TICKS);
    return;
  }
  const r = rng.next();
  if (r < 0.4) startWalk(s, tick, rng.range(-Math.PI, Math.PI), rng.intRange(30, 150));
  else if (r < 0.75 || !startBuild(s, rng, senses, player, tick))
    startMine(s, rng, senses, player, tick);
  s.sprint = rng.chance(0.3);
}

/** Mines the block below (15 %, briefly: a shallow hole), the ground just ahead or further. */
function startMine(
  s: BotState,
  rng: Rng,
  senses: BotSenses,
  player: Readonly<PlayerState>,
  tick: number,
): void {
  const r = rng.next();
  begin(s, 'mine', tick, r < 0.15 ? rng.intRange(25, 60) : rng.intRange(60, 180));
  s.pitch = r < 0.15 ? DIG_DOWN : r < 0.6 ? GROUND_AHEAD : AHEAD;
  s.yaw += rng.range(-0.5, 0.5);
  s.slot = handSlot(senses, player.inventory, s.slot);
}

/**
 * Places blocks on the ground ahead while backing away and turning a little: a low curved wall
 * (crouched: it never opens a chest and does not back off an edge). Not in a pit, where every
 * block would go into its own cell.
 */
function startBuild(
  s: BotState,
  rng: Rng,
  senses: BotSenses,
  player: Readonly<PlayerState>,
  tick: number,
): boolean {
  const slot = slotWith(senses, player.inventory, BLOCK, FOOD | DRINK);
  if (slot < 0 || walledIn(senses, player.body)) return false;
  begin(s, 'build', tick, rng.intRange(20, 90));
  s.slot = slot;
  s.pitch = rng.range(-0.8, -0.4);
  s.turn = rng.range(-0.05, 0.05);
  return true;
}

/** The buttons of this tick's task (it may turn the view). */
function act(
  s: BotState,
  rng: Rng,
  senses: BotSenses,
  player: Readonly<PlayerState>,
  tick: number,
): number {
  const b = player.body;
  switch (s.task) {
    case 'walk': {
      if (s.climb > 0) return climb(s);
      s.pitch = 0;
      const jump = s.stuck > JUMP_AFTER || b.inWater || rng.chance(0.01);
      const sprint = s.sprint && player.stamina > 20;
      return FORWARD | (jump ? JUMP : 0) | (sprint ? SPRINT : 0);
    }
    case 'mine':
    case 'dig':
      return PRIMARY;
    case 'build':
      s.yaw += s.turn;
      return CROUCH | SECONDARY | BACK;
    case 'eat':
      return SECONDARY;
    case 'seek':
      return s.climb > 0 ? climb(s) : seek(s, senses, player, tick);
  }
}

/**
 * One tick of a climb: looking straight down, it jumps (again on each landing) and places the
 * block under its feet once they clear the cell (a held secondary places every few ticks), then
 * walks on the same way.
 */
function climb(s: BotState): number {
  s.climb--;
  s.pitch = -PITCH_LIMIT;
  return JUMP | SECONDARY;
}
