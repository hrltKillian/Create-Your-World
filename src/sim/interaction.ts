import { FLAG_SOLID, type Registry } from '../content/registry.ts';
import { createRayHit } from '../world/raycast.ts';
import { createBlockEntity } from './blockEntities.ts';
import { openBlockEntity } from './blockEntityCommands.ts';
import { removeWhole } from './blockRemoval.ts';
import { noteChanged } from './blockUpdates.ts';
import { TICK_SECONDS } from './clock.ts';
import { reject } from './commandRules.ts';
import { holdUse, NO_USE } from './consume.ts';
import { recoverPack } from './death.ts';
import { editBlock } from './edits.ts';
import type { SimEvent } from './events.ts';
import { spendUses, takeFromSlot } from './inventory.ts';
import { meleeTarget, stepMelee } from './melee.ts';
import {
  breakSeconds,
  canHarvest,
  MINING,
  TOOL_TOO_WEAK_HINT,
  toolWear,
  weakToolParams,
} from './mining.ts';
import {
  bodyInCell,
  otherHalfY,
  PLACE_REPEAT_TICKS,
  type Placement,
  planPlacement,
} from './placement.ts';
import { type PlayerState, STAMINA, spendStamina } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { sleepOn } from './sleep.ts';
import { AIM_HIT, AIM_NONE, AIM_OUT_OF_REACH, aim } from './targeting.ts';

/** Progress at which a block breaks (absorbs the rounding of summed tick fractions). */
const BROKEN = 1 - 1e-9;

/** Scratch aim, aimed creature and placement (no allocation per tick). */
const hit = createRayHit();
const creatureAt = { distance: 0 };
const placement: Placement = { x: 0, y: 0, z: 0, state: 0, upper: -1 };

/**
 * One tick of a player's interaction with the world (docs/conception.md « Priorité des actions »).
 * Creatures are tested first (« Ciblage »): primary attacks a creature in reach, only solid blocks
 * stopping the blow (melee.ts), else mines the aimed block while held. Secondary acts on the aimed
 * block unless a creature in reach stands in front of it: it uses an interactive block on the
 * press (toggles a gate, opens a chest or station, sleeps on a bedroll, takes back an Abandoned
 * Pack), else eats, drinks or fills while held (consume.ts), else places the held block, again
 * every 6 ticks while held; crouching forces the placement.
 */
export function stepInteraction(sim: Simulation, player: PlayerState, out: SimEvent[]): void {
  const creature = meleeTarget(sim, player, creatureAt);
  const status = aim(sim.world, sim.registry.tables, player, hit);
  const attacking = stepMelee(sim, player, creature, out);
  if (player.input.primary && status === AIM_HIT && !attacking) mine(sim, player, out);
  else stopMining(player, out);
  const shielded = creature !== undefined && creatureAt.distance < hit.distance;
  useButton(sim, player, shielded ? AIM_NONE : status, out);
}

/** Selected hotbar item id (−1: empty hand). */
function heldItem(sim: Simulation, player: PlayerState): number {
  const stack = player.inventory[player.input.slot];
  return stack ? sim.registry.itemId(stack.item) : -1;
}

function mine(sim: Simulation, player: PlayerState, out: SimEvent[]): void {
  const st = player.interaction;
  const itemId = heldItem(sim, player);
  const seconds = breakSeconds(sim.registry, hit.state, itemId, player.exhausted);
  if (seconds === Number.POSITIVE_INFINITY) {
    stopMining(player, out);
    return;
  }
  if (st.mineStage < 0 || hit.x !== st.mineX || hit.y !== st.mineY || hit.z !== st.mineZ) {
    // A new target: progress starts over.
    stopMining(player, out);
    st.mineX = hit.x;
    st.mineY = hit.y;
    st.mineZ = hit.z;
    st.mineProgress = 0;
    reportStage(player, 0, out);
    const params = weakToolParams(sim.registry, hit.state, itemId);
    if (params)
      out.push({ type: 'hint', playerId: player.playerId, key: TOOL_TOO_WEAK_HINT, params });
  }
  spendStamina(player, STAMINA.minePerSecond * TICK_SECONDS);
  st.mineProgress += seconds > 0 ? TICK_SECONDS / seconds : 1;
  if (st.mineProgress >= BROKEN) {
    stopMining(player, out);
    breakAimed(sim, player, itemId, out);
    return;
  }
  reportStage(
    player,
    Math.min(MINING.stages - 1, Math.floor(st.mineProgress * MINING.stages)),
    out,
  );
  if (sim.tick % MINING.hitSoundTicks === 0) {
    const sfx = sim.registry.blockSfx(hit.state, 'hit');
    if (sfx) out.push({ type: 'sound', sfx, x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 });
  }
}

function reportStage(player: PlayerState, stage: number, out: SimEvent[]): void {
  const st = player.interaction;
  if (stage === st.mineStage) return;
  st.mineStage = stage;
  out.push({
    type: 'mineProgress',
    playerId: player.playerId,
    x: st.mineX,
    y: st.mineY,
    z: st.mineZ,
    stage,
  });
}

/** Stops mining (its crack goes). */
export function stopMining(player: PlayerState, out: SimEvent[]): void {
  if (player.interaction.mineStage >= 0) reportStage(player, -1, out);
  player.interaction.mineProgress = 0;
}

/** Breaks the aimed block and wears the held tool; what stood on it pops (blockUpdates.ts). */
function breakAimed(sim: Simulation, player: PlayerState, itemId: number, out: SimEvent[]): void {
  const { x, y, z, state } = hit;
  removeWhole(sim, player.playerId, x, y, z, canHarvest(sim.registry, state, itemId), out);
  const wear = toolWear(sim.registry, state, itemId);
  if (wear > 0 && player.inventory[player.input.slot]) {
    spendUses(sim.registry, player.inventory, player.input.slot, wear);
    out.push({ type: 'inventoryChanged', playerId: player.playerId });
  }
}

/**
 * Secondary button: an aimed interactive block on the press; else what the hand eats, drinks or
 * fills while held; else a placement on the press, then every PLACE_REPEAT_TICKS while held.
 */
function useButton(sim: Simulation, player: PlayerState, status: number, out: SimEvent[]): void {
  const st = player.interaction;
  const input = player.input;
  const pressed = input.secondary && !st.useHeld;
  st.useHeld = input.secondary;
  if (!input.secondary) {
    st.useCooldown = 0;
    st.useItem = NO_USE;
    return;
  }
  if (status === AIM_HIT && usesAimedBlock(sim.registry, hit.state, input.crouch)) {
    // The aimed block stops a held meal until the next press, as another hand does (consume.ts).
    st.useItem = NO_USE;
    if (pressed) useAimed(sim, player, out);
    return;
  }
  if (holdUse(sim, player, pressed, out)) return;
  st.useItem = NO_USE;
  if (!pressed && --st.useCooldown > 0) return;
  st.useCooldown = PLACE_REPEAT_TICKS;
  if (status === AIM_OUT_OF_REACH) reject(out, player.playerId, 'input', 'reach');
  else if (status === AIM_HIT) place(sim, player, out);
}

/**
 * Whether secondary acts on the aimed block (a gate, a chest, a station, a bedroll, an Abandoned
 * Pack) instead of placing: crouching forces the placement.
 */
export function usesAimedBlock(registry: Registry, state: number, crouch: boolean): boolean {
  if (crouch) return false;
  return (
    registry.prop(state, 'open') !== undefined || registry.blockDef(state).blockEntity !== undefined
  );
}

/**
 * Opens the screen of an aimed chest or station, sleeps on a bedroll, takes back a pack, or
 * toggles a gate.
 */
function useAimed(sim: Simulation, player: PlayerState, out: SimEvent[]): void {
  const { x, y, z } = hit;
  const kind = sim.registry.blockDef(hit.state).blockEntity;
  let refusal: string | null = null;
  // The aim has confirmed the line of sight (a client target, or the simulation's own ray).
  if (kind === 'container' || kind === 'station' || kind === 'workbench')
    refusal = openBlockEntity(sim, player, x, y, z, out, true);
  else if (kind === 'bed') sleepOn(sim, player, x, y, z, out);
  else if (kind === 'grave') refusal = recoverPack(sim, player, x, y, z, out);
  else toggleOpen(sim, player, out);
  if (refusal) reject(out, player.playerId, 'input', refusal);
}

/**
 * Opens or closes a gate, both halves of a tall one (closing is refused while a player or a
 * creature stands in it), with the pack's door sounds (its place sound without them). An open gate
 * bears nothing: what stood on it pops, as if it broke.
 */
function toggleOpen(sim: Simulation, player: PlayerState, out: SimEvent[]): void {
  const registry = sim.registry;
  const { x, y, z } = hit;
  const value = registry.prop(hit.state, 'open') === '1' ? '0' : '1';
  const next = registry.withState(hit.state, 'open', value);
  const other = otherHalfY(sim.world, registry, x, y, z);
  const bottom = Math.min(y, other);
  if (
    (registry.tables.flags[next]! & FLAG_SOLID) !== 0 &&
    bodyInCell(sim.entities, registry, x, bottom, z, Math.abs(other - y) + 1)
  ) {
    reject(out, player.playerId, 'input', 'occupied');
    return;
  }
  editBlock(sim.world, sim.light, x, y, z, next, out);
  if (other !== y) {
    const partner = registry.withState(sim.world.getBlock(x, other, z), 'open', value);
    editBlock(sim.world, sim.light, x, other, z, partner, out);
  }
  const door = registry.pack.sounds?.door;
  const sfx = door ? door[value === '1' ? 'open' : 'close'] : registry.blockSfx(next, 'place');
  if (sfx) out.push({ type: 'sound', sfx, x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  // An open gate bears nothing: what stood on it or hung on its sides checks its support (and
  // liquids beside it flow anew).
  noteChanged(sim, x, y, z);
  if (other !== y) noteChanged(sim, x, other, z);
}

/** Places one of the held blocks against the aimed face. */
function place(sim: Simulation, player: PlayerState, out: SimEvent[]): void {
  const itemId = heldItem(sim, player);
  const state = itemId < 0 ? -1 : sim.registry.itemTables.places[itemId]!;
  if (state < 0) return;
  const refusal = planPlacement(
    sim.world,
    sim.registry,
    sim.entities,
    player,
    hit,
    state,
    placement,
  );
  if (refusal) {
    reject(out, player.playerId, 'input', refusal);
    return;
  }
  const { x, y, z } = placement;
  editBlock(sim.world, sim.light, x, y, z, placement.state, out);
  // A tall block (door): its upper half goes in the cell above, checked free by planPlacement.
  if (placement.upper >= 0) editBlock(sim.world, sim.light, x, y + 1, z, placement.upper, out);
  // A block placed in or beside a liquid changes its flow.
  noteChanged(sim, x, y, z);
  // A placed chest or station starts empty (only generated chests hold loot).
  createBlockEntity(sim, x, y, z, false);
  takeFromSlot(player.inventory, player.input.slot, 1);
  out.push({ type: 'blockPlaced', playerId: player.playerId, x, y, z, state: placement.state });
  const sfx = sim.registry.blockSfx(placement.state, 'place');
  if (sfx) out.push({ type: 'sound', sfx, x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  out.push({ type: 'inventoryChanged', playerId: player.playerId });
}
