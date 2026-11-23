import { blockItemKey } from '../content/items.ts';
import { FLAG_SOLID, type Registry } from '../content/registry.ts';
import { hash32 } from '../core/hash.ts';
import { WORLD_HEIGHT } from '../world/coords.ts';
import { createRayHit } from '../world/raycast.ts';
import { blockEntityAt, createBlockEntity, removeBlockEntity } from './blockEntities.ts';
import { openBlockEntity } from './blockEntityCommands.ts';
import { TICK_SECONDS } from './clock.ts';
import { reject } from './commandRules.ts';
import { editBlock } from './edits.ts';
import type { SimEvent } from './events.ts';
import { takeFromSlot } from './inventory.ts';
import { spawnDrop } from './itemDrops.ts';
import { rollLoot } from './loot.ts';
import {
  breakSeconds,
  canHarvest,
  MINING,
  TOOL_TOO_WEAK_HINT,
  toolWear,
  weakToolParams,
} from './mining.ts';
import {
  otherHalfY,
  PLACE_REPEAT_TICKS,
  type Placement,
  planPlacement,
  playerInCell,
} from './placement.ts';
import { type PlayerState, STAMINA, spendStamina } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { AIM_HIT, AIM_OUT_OF_REACH, aim } from './targeting.ts';

/** Progress at which a block breaks (absorbs the rounding of summed tick fractions). */
const BROKEN = 1 - 1e-9;

/** Scratch aim and placement (no allocation per tick). */
const hit = createRayHit();
const placement: Placement = { x: 0, y: 0, z: 0, state: 0, upper: -1 };

/**
 * One tick of a player's interaction with the world (docs/conception.md « Priorité des actions »).
 * Primary mines the aimed block while held (creatures come first from M10). Secondary toggles an
 * interactive block (gates) or opens a chest or station on the press, else places the held block,
 * again every 6 ticks while held; crouching forces the placement. Consuming, drinking and filling
 * arrive in M9.
 */
export function stepInteraction(sim: Simulation, player: PlayerState, out: SimEvent[]): void {
  const status = aim(sim.world, sim.registry.tables, player, hit);
  if (player.input.primary && status === AIM_HIT) mine(sim, player, out);
  else stopMining(player, out);
  useButton(sim, player, status, out);
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

function stopMining(player: PlayerState, out: SimEvent[]): void {
  if (player.interaction.mineStage >= 0) reportStage(player, -1, out);
  player.interaction.mineProgress = 0;
}

/** Breaks the aimed block, wears the held tool and pops the blocks that stood on it. */
function breakAimed(sim: Simulation, player: PlayerState, itemId: number, out: SimEvent[]): void {
  const { x, y, z, state } = hit;
  let top = breakWhole(sim, player, x, y, z, canHarvest(sim.registry, state, itemId), out);
  const wear = toolWear(sim.registry, state, itemId);
  const slot = player.input.slot;
  const stack = player.inventory[slot];
  if (wear > 0 && stack) {
    stack.durability = (stack.durability ?? sim.registry.itemTables.durability[itemId]!) - wear;
    if (stack.durability <= 0) player.inventory[slot] = null;
    out.push({ type: 'inventoryChanged', playerId: player.playerId });
  }
  while (top + 1 < WORLD_HEIGHT) {
    const def = sim.registry.blockDef(sim.world.getBlock(x, top + 1, z));
    if (def.placement?.support !== 'below') break;
    top = breakWhole(sim, player, x, top + 1, z, true, out);
  }
}

/**
 * Breaks a block and, for a tall block (door), its other half too, which drops nothing (one item
 * for the whole door). Returns the highest y removed.
 */
function breakWhole(
  sim: Simulation,
  player: PlayerState,
  x: number,
  y: number,
  z: number,
  harvest: boolean,
  out: SimEvent[],
): number {
  const other = otherHalfY(sim.world, sim.registry, x, y, z);
  breakBlock(sim, player, x, y, z, harvest, out);
  if (other === y) return y;
  breakBlock(sim, player, x, other, z, false, out);
  return Math.max(y, other);
}

/**
 * Removes a block, with its sound, event and (when harvested) its drops; what its block entity
 * held spills, harvested or not (a generated chest gets its loot first).
 */
function breakBlock(
  sim: Simulation,
  player: PlayerState,
  x: number,
  y: number,
  z: number,
  harvest: boolean,
  out: SimEvent[],
): void {
  const registry = sim.registry;
  const state = sim.world.getBlock(x, y, z);
  const kept = blockEntityAt(sim, x, y, z) !== undefined;
  if (!editBlock(sim.world, sim.light, x, y, z, registry.air, out)) return;
  if (kept) removeBlockEntity(sim, x, y, z);
  out.push({ type: 'blockBroken', playerId: player.playerId, x, y, z, state });
  const sfx = registry.blockSfx(state, 'break');
  if (sfx) out.push({ type: 'sound', sfx, x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  if (!harvest) return;
  const drops = registry.blockDef(state).drops;
  const give = (item: string, count: number) =>
    spawnDrop(sim, { item, count }, x + 0.5, y + 0.5, z + 0.5);
  if (drops === 'self') give(blockItemKey(registry.blockDef(state).key), 1);
  else if (drops !== 'none') {
    const table = registry.loot(drops);
    if (table) rollLoot(table, hash32(hash32(sim.ctx.seedHash, x, y, z), sim.tick), give);
  }
}

/** Secondary button: acts on the press, then every PLACE_REPEAT_TICKS while held. */
function useButton(sim: Simulation, player: PlayerState, status: number, out: SimEvent[]): void {
  const st = player.interaction;
  const input = player.input;
  const pressed = input.secondary && !st.useHeld;
  st.useHeld = input.secondary;
  if (!input.secondary) {
    st.useCooldown = 0;
    return;
  }
  if (!pressed && --st.useCooldown > 0) return;
  st.useCooldown = PLACE_REPEAT_TICKS;
  if (status === AIM_OUT_OF_REACH) {
    reject(out, player.playerId, 'input', 'reach');
    return;
  }
  if (status !== AIM_HIT) return;
  if (usesAimedBlock(sim.registry, hit.state, input.crouch)) {
    if (pressed) useAimed(sim, player, out);
    return;
  }
  place(sim, player, out);
}

/**
 * Whether secondary acts on the aimed block (opens a gate, a chest or a station) instead of
 * placing: crouching forces the placement.
 */
export function usesAimedBlock(registry: Registry, state: number, crouch: boolean): boolean {
  if (crouch) return false;
  const kind = registry.blockDef(state).blockEntity;
  return registry.prop(state, 'open') !== undefined || kind === 'container' || kind === 'station';
}

/** Opens the screen of an aimed chest or station, or toggles an aimed gate. */
function useAimed(sim: Simulation, player: PlayerState, out: SimEvent[]): void {
  const kind = sim.registry.blockDef(hit.state).blockEntity;
  if (kind !== 'container' && kind !== 'station') {
    toggleOpen(sim, player, out);
    return;
  }
  const refusal = openBlockEntity(sim, player, hit.x, hit.y, hit.z, out);
  if (refusal) reject(out, player.playerId, 'input', refusal);
}

/**
 * Opens or closes a gate, both halves of a tall one (closing is refused while a player stands in
 * it).
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
    playerInCell(sim.players.values(), x, bottom, z, Math.abs(other - y) + 1)
  ) {
    reject(out, player.playerId, 'input', 'occupied');
    return;
  }
  editBlock(sim.world, sim.light, x, y, z, next, out);
  if (other !== y) {
    const partner = registry.withState(sim.world.getBlock(x, other, z), 'open', value);
    editBlock(sim.world, sim.light, x, other, z, partner, out);
  }
  const sfx = registry.blockSfx(next, 'place');
  if (sfx) out.push({ type: 'sound', sfx, x: x + 0.5, y: y + 0.5, z: z + 0.5 });
}

/** Places one of the held blocks against the aimed face. */
function place(sim: Simulation, player: PlayerState, out: SimEvent[]): void {
  const itemId = heldItem(sim, player);
  const state = itemId < 0 ? -1 : sim.registry.itemTables.places[itemId]!;
  if (state < 0) return;
  const refusal = planPlacement(
    sim.world,
    sim.registry,
    sim.players.values(),
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
  // A placed chest or station starts empty (only generated chests hold loot).
  createBlockEntity(sim, x, y, z, false);
  takeFromSlot(player.inventory, player.input.slot, 1);
  out.push({ type: 'blockPlaced', playerId: player.playerId, x, y, z, state: placement.state });
  const sfx = sim.registry.blockSfx(placement.state, 'place');
  if (sfx) out.push({ type: 'sound', sfx, x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  out.push({ type: 'inventoryChanged', playerId: player.playerId });
}
