import { Matrix4 } from 'three';
import type { Registry } from '../content/registry.ts';
import type { ItemDropState } from '../sim/itemDrops.ts';
import type { Entity } from '../sim/Simulation.ts';
import { blockOf, skyOf } from '../world/light.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import type { BoxBatch } from './BoxBatch.ts';
import { drawItem, type ItemModel } from './itemModels.ts';
import { nthSmallest } from './nearest.ts';

/** Drops within this distance of the camera are drawn in detail (blocks)… */
const DETAIL_DISTANCE = 8;
/** …but never more than this many of them, the nearest first. */
const MAX_DETAILED = 64;
/** Drawn size: edge of a block item (its 0.25 collision cube) and height of a sprite item. */
const BLOCK_SIZE = 0.25;
const SPRITE_SIZE = 0.45;
const BOB_HEIGHT = 0.06;
const BOB_RATE = 2.5;
const SPIN_RATE = 1.6;

/**
 * Draws the item drops into the world BoxBatch, bobbing and spinning: the 64 nearest within 8 blocks
 * with every box of their model, the others as one textured box. No allocation per frame.
 */
export class DropView {
  private readonly batch: BoxBatch;
  private readonly world: VoxelWorld;
  private readonly registry: Registry;
  private readonly items: readonly ItemModel[];
  private readonly base = new Matrix4();
  private readonly turn = new Matrix4();
  /** Squared distances of the drops within DETAIL_DISTANCE this frame (grown on demand). */
  private near = new Float64Array(256);
  private nearCount = 0;
  /** Squared distance up to which a drop is detailed this frame. */
  private detailLimit = 0;
  private detailed = 0;
  private camX = 0;
  private camY = 0;
  private camZ = 0;
  private alpha = 1;
  private time = 0;
  private readonly measure = (entity: Readonly<Entity>): void => {
    if (entity.kind !== 'itemDrop') return;
    const d = this.distance2(entity);
    if (d > DETAIL_DISTANCE * DETAIL_DISTANCE) return;
    if (this.nearCount === this.near.length) {
      const grown = new Float64Array(this.near.length * 2);
      grown.set(this.near);
      this.near = grown;
    }
    this.near[this.nearCount++] = d;
  };
  private readonly draw = (entity: Readonly<Entity>): void => {
    if (entity.kind === 'itemDrop') this.drawDrop(entity);
  };

  constructor(batch: BoxBatch, world: VoxelWorld, registry: Registry, items: readonly ItemModel[]) {
    this.batch = batch;
    this.world = world;
    this.registry = registry;
    this.items = items;
  }

  /** Adds every drop of `entities`, interpolated between the last two ticks by `alpha`. */
  drawAll(
    entities: ReadonlyMap<number, Readonly<Entity>>,
    camX: number,
    camY: number,
    camZ: number,
    alpha: number,
    dt: number,
  ): void {
    this.camX = camX;
    this.camY = camY;
    this.camZ = camZ;
    this.alpha = alpha;
    this.time = (this.time + dt) % 3600;
    this.nearCount = 0;
    entities.forEach(this.measure);
    this.detailLimit =
      this.nearCount > MAX_DETAILED
        ? nthSmallest(this.near, this.nearCount, MAX_DETAILED, sorted)
        : DETAIL_DISTANCE * DETAIL_DISTANCE;
    this.detailed = 0;
    entities.forEach(this.draw);
  }

  private x(d: Readonly<ItemDropState>): number {
    return d.prevX + (d.body.x - d.prevX) * this.alpha;
  }

  private y(d: Readonly<ItemDropState>): number {
    return d.prevY + (d.body.y - d.prevY) * this.alpha;
  }

  private z(d: Readonly<ItemDropState>): number {
    return d.prevZ + (d.body.z - d.prevZ) * this.alpha;
  }

  private distance2(d: Readonly<ItemDropState>): number {
    const dx = this.x(d) - this.camX;
    const dy = this.y(d) - this.camY;
    const dz = this.z(d) - this.camZ;
    return dx * dx + dy * dy + dz * dz;
  }

  private drawDrop(d: Readonly<ItemDropState>): void {
    const item = this.registry.itemId(d.item);
    if (item < 0) return;
    const model = this.items[item]!;
    const x = this.x(d);
    const y = this.y(d);
    const z = this.z(d);
    const size = model.sprite ? SPRITE_SIZE : BLOCK_SIZE;
    // Per-drop phase from its id, so neighbouring drops do not bob in step.
    const phase = this.time + d.id * 0.7;
    const lift = size / 2 + BOB_HEIGHT * (1 + Math.sin(phase * BOB_RATE));
    this.base.makeRotationY(phase * SPIN_RATE).setPosition(x, y + lift, z);
    this.base.multiply(this.turn.makeScale(size, size, size));
    const detailed = this.distance2(d) <= this.detailLimit && this.detailed < MAX_DETAILED;
    if (detailed) this.detailed++;
    const light = this.world.getLight(Math.floor(x), Math.floor(y + 0.1), Math.floor(z));
    drawItem(this.batch, model, this.base, skyOf(light) / 15, blockOf(light) / 15, detailed);
  }
}

/** Scratch of `nthSmallest`: the nearest detailed drops, sorted. */
const sorted = new Float64Array(MAX_DETAILED);
