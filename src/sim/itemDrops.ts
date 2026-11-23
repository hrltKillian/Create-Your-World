import type { RawTables } from '../content/registry.ts';
import { blockToColumn } from '../world/coords.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import { TICK_SECONDS } from './clock.ts';
import { aabb, isLiquid, moveAxis, overlapsSolid } from './collision.ts';
import type { SimEvent } from './events.ts';
import { addItem, type ItemStack } from './inventory.ts';
import { bodyHeight, PHYSICS } from './physics.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';

/** Item drop rules (docs/conception.md « Objets au sol »). */
export const DROPS = {
  /** Players pick up drops within this distance of their body (m). */
  magnet: 1.6,
  mergeEveryTicks: 10,
  /** Same-item drops this close merge (m). */
  mergeRadius: 0.8,
  /** 5 minutes. */
  despawnTicks: 9000,
  /** The oldest drop goes when a new one would exceed this. */
  max: 200,
  /** 0.6 s, for items thrown by a player only (mined items can be picked up at once). */
  thrownPickupDelayTicks: 18,
  /** Speed of a thrown item along the view (m/s). */
  throwSpeed: 4,
  /** Edge of a drop's collision cube (m). */
  size: 0.25,
  /** Horizontal speed kept per tick on the ground and in liquids. */
  groundFriction: 0.5,
  liquidDrag: 0.8,
  /** Sinking speed in liquids (m/s). */
  sinkSpeed: 1,
} as const;

/** Position (centre of the bottom face) and velocity of a drop. */
export interface DropBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
}

/** An item lying in the world: plain JSON, saved with its column from M7. */
export interface ItemDropState {
  readonly kind: 'itemDrop';
  readonly id: number;
  item: string;
  count: number;
  durability?: number;
  body: DropBody;
  /** Position at the previous tick (render interpolation). */
  prevX: number;
  prevY: number;
  prevZ: number;
  /** Ticks since it appeared. */
  age: number;
  /** Ticks before anyone may pick it up. */
  pickupDelay: number;
}

/** Scratch list of nearby entity ids (no allocation once warmed up). */
const near: number[] = [];

/** Puts items in the world at a position (bottom centre), removing the oldest drop past the cap. */
export function spawnDrop(
  sim: Simulation,
  stack: ItemStack,
  x: number,
  y: number,
  z: number,
  vx = 0,
  vy = 0,
  vz = 0,
  pickupDelay = 0,
): ItemDropState {
  let count = 0;
  let oldest = -1;
  for (const entity of sim.entities.values()) {
    if (entity.kind !== 'itemDrop') continue;
    if (oldest < 0) oldest = entity.id;
    count++;
  }
  if (count >= DROPS.max) removeDrop(sim, oldest);
  const drop: ItemDropState = {
    kind: 'itemDrop',
    id: sim.nextEntityId++,
    item: stack.item,
    count: stack.count,
    body: { x, y, z, vx, vy, vz, onGround: false },
    prevX: x,
    prevY: y,
    prevZ: z,
    age: 0,
    pickupDelay,
  };
  if (stack.durability !== undefined) drop.durability = stack.durability;
  sim.entities.set(drop.id, drop);
  sim.spatial.update(drop.id, x, z);
  return drop;
}

function removeDrop(sim: Simulation, id: number): void {
  sim.entities.delete(id);
  sim.spatial.remove(id);
}

/**
 * Item drops for one tick: ageing and despawn, falling and sliding, pickups by nearby players, and
 * merging of close stacks every 10 ticks. Drops whose column is not loaded are removed (from M7 they
 * are saved with their column instead).
 */
export function stepItemDrops(sim: Simulation, out: SimEvent[]): void {
  const tables = sim.registry.tables;
  for (const entity of sim.entities.values()) {
    if (entity.kind !== 'itemDrop') continue;
    const b = entity.body;
    entity.age++;
    if (
      entity.age >= DROPS.despawnTicks ||
      !sim.world.getColumn(blockToColumn(b.x), blockToColumn(b.z))
    ) {
      removeDrop(sim, entity.id);
      continue;
    }
    if (entity.pickupDelay > 0) entity.pickupDelay--;
    entity.prevX = b.x;
    entity.prevY = b.y;
    entity.prevZ = b.z;
    stepDropBody(sim.world, tables, b);
    sim.spatial.update(entity.id, b.x, b.z);
  }
  for (const player of sim.players.values()) pickUp(sim, player, out);
  if (sim.tick % DROPS.mergeEveryTicks === 0) mergeDrops(sim);
}

/** Gravity, liquid drag and ground friction against the voxels (a 0.25 m cube). */
function stepDropBody(world: VoxelWorld, tables: RawTables, b: DropBody): void {
  const dt = TICK_SECONDS;
  const half = DROPS.size / 2;
  const wet = isLiquid(world, tables, b.x, b.y + half, b.z);
  b.vy = Math.max(b.vy - PHYSICS.gravity * dt, -PHYSICS.terminal);
  if (wet) {
    b.vx *= DROPS.liquidDrag;
    b.vz *= DROPS.liquidDrag;
    b.vy = Math.max(b.vy, -DROPS.sinkSpeed);
  }
  aabb[0] = b.x - half;
  aabb[1] = b.y;
  aabb[2] = b.z - half;
  aabb[3] = b.x + half;
  aabb[4] = b.y + DROPS.size;
  aabb[5] = b.z + half;
  if (overlapsSolid(world, tables)) {
    // Buried by a placed block: rise out of it, one cell per tick.
    b.y = Math.floor(b.y) + 1;
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    b.onGround = false;
    return;
  }
  const wantY = b.vy * dt;
  const dy = moveAxis(world, tables, 1, wantY);
  b.onGround = wantY < 0 && dy > wantY;
  if (dy !== wantY) b.vy = 0;
  const wantX = b.vx * dt;
  const dx = moveAxis(world, tables, 0, wantX);
  if (dx !== wantX) b.vx = 0;
  const wantZ = b.vz * dt;
  const dz = moveAxis(world, tables, 2, wantZ);
  if (dz !== wantZ) b.vz = 0;
  b.x += dx;
  b.y += dy;
  b.z += dz;
  if (b.onGround) {
    b.vx *= DROPS.groundFriction;
    b.vz *= DROPS.groundFriction;
  }
}

/** Distance from a drop's centre to a player's body (its vertical axis from feet to head). */
function distanceToPlayer(drop: DropBody, player: PlayerState): number {
  const b = player.body;
  const cy = drop.y + DROPS.size / 2;
  const top = b.y + bodyHeight(b);
  const dx = drop.x - b.x;
  const dz = drop.z - b.z;
  const dy = cy < b.y ? b.y - cy : cy > top ? cy - top : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Moves every drop within the magnet radius into the player's inventory, as far as it fits. */
function pickUp(sim: Simulation, player: PlayerState, out: SimEvent[]): void {
  sim.spatial.query(player.body.x, player.body.z, DROPS.magnet, near);
  let changed = false;
  for (let i = 0; i < near.length; i++) {
    const drop = sim.entities.get(near[i]!);
    if (drop?.kind !== 'itemDrop' || drop.pickupDelay > 0) continue;
    if (distanceToPlayer(drop.body, player) > DROPS.magnet) continue;
    const left = addItem(player.inventory, sim.registry, drop.item, drop.count, drop.durability);
    const taken = drop.count - left;
    if (taken === 0) continue;
    changed = true;
    out.push({
      type: 'itemPickedUp',
      playerId: player.playerId,
      entityId: drop.id,
      item: drop.item,
      count: taken,
    });
    const sfx = sim.registry.pack.sounds?.pickup;
    if (sfx) out.push({ type: 'sound', sfx, x: drop.body.x, y: drop.body.y, z: drop.body.z });
    if (left === 0) removeDrop(sim, drop.id);
    else drop.count = left;
  }
  if (changed) out.push({ type: 'inventoryChanged', playerId: player.playerId });
}

/** Older drops absorb newer ones of the same item close by (never tools, which carry wear). */
function mergeDrops(sim: Simulation): void {
  const r2 = DROPS.mergeRadius * DROPS.mergeRadius;
  for (const a of sim.entities.values()) {
    if (a.kind !== 'itemDrop' || a.durability !== undefined) continue;
    const max = sim.registry.maxStack(a.item);
    sim.spatial.query(a.body.x, a.body.z, DROPS.mergeRadius, near);
    for (let i = 0; i < near.length && a.count < max; i++) {
      const b = sim.entities.get(near[i]!);
      if (b?.kind !== 'itemDrop' || b.id <= a.id || b.item !== a.item) continue;
      if (b.durability !== undefined) continue;
      const dx = b.body.x - a.body.x;
      const dy = b.body.y - a.body.y;
      const dz = b.body.z - a.body.z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      const moved = Math.min(b.count, max - a.count);
      a.count += moved;
      b.count -= moved;
      a.age = Math.min(a.age, b.age);
      a.pickupDelay = Math.max(a.pickupDelay, b.pickupDelay);
      if (b.count === 0) removeDrop(sim, b.id);
    }
  }
}
