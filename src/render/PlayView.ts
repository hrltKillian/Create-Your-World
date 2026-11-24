import type { DataArrayTexture } from 'three';
import type { SimEvent } from '../sim/events.ts';
import type { SimView } from '../sim/host.ts';
import type { PlayerState } from '../sim/player.ts';
import { blockToColumn, SECTION_SIZE } from '../world/coords.ts';
import { blockOf, skyOf } from '../world/light.ts';
import { BlockOverlay, type OverlayTargets } from './BlockOverlay.ts';
import { BoxBatch, WORLD_BOXES } from './BoxBatch.ts';
import { CreatureView } from './CreatureView.ts';
import { DropView } from './DropView.ts';
import { EntityView } from './EntityView.ts';
import { HandView } from './HandView.ts';
import { buildItemModels } from './itemModels.ts';
import { Particles } from './Particles.ts';
import type { CameraPose, WorldView } from './WorldView.ts';

/** What one frame of play shows besides the chunks (filled by the session). */
export interface PlayFrame {
  readonly player: Readonly<PlayerState>;
  /** Interpolation between the last two ticks. */
  readonly alpha: number;
  readonly dt: number;
  readonly pose: CameraPose;
  /** Interpolated eye (the hand view takes its light). */
  readonly eye: { readonly x: number; readonly y: number; readonly z: number };
  readonly firstPerson: boolean;
  /** The avatar is drawn (third person, camera not pressed against it). */
  readonly avatarVisible: boolean;
  readonly targets: OverlayTargets;
}

/**
 * Everything drawn during play on top of the chunks: the world BoxBatch (avatar, held item in
 * third person, item drops, break particles, then creatures), the block overlays and the
 * first-person hand view. It reacts to the simulation's interaction and combat events.
 */
export class PlayView {
  readonly batch: BoxBatch;
  readonly entities: EntityView;
  readonly creatures: CreatureView;
  readonly drops: DropView;
  readonly particles: Particles;
  readonly overlay: BlockOverlay;
  readonly hand: HandView;
  private readonly sim: SimView;
  private readonly view: WorldView;

  constructor(view: WorldView, sim: SimView) {
    this.sim = sim;
    this.view = view;
    const registry = sim.registry;
    const shared = view.materials.uniforms;
    const textures: DataArrayTexture = shared.uTextures.value;
    const items = buildItemModels(
      registry,
      textures.image.data as Uint8Array,
      textures.image.width,
    );
    this.batch = new BoxBatch(shared, WORLD_BOXES, true);
    this.entities = new EntityView(this.batch, sim.world, registry, items);
    this.creatures = new CreatureView(this.batch, sim.world, registry);
    this.drops = new DropView(this.batch, sim.world, registry, items);
    this.particles = new Particles(this.batch, sim.world, registry.tables);
    this.overlay = new BlockOverlay(shared, sim.world, registry.tables, registry.pack);
    this.hand = new HandView(shared, registry, items);
    view.scene.add(this.batch.mesh, this.overlay.group);
    view.attachHand(this.hand);
  }

  onEvent(event: SimEvent): void {
    const local = 'playerId' in event && event.playerId === this.sim.playerId;
    if (event.type === 'mineProgress' && local)
      this.overlay.setCrack(event.x, event.y, event.z, event.stage);
    else if (event.type === 'blockBroken')
      this.particles.burst(event.x, event.y, event.z, event.state);
    else if (event.type === 'blockPlaced' && local) this.hand.strike();
    else if (event.type === 'creatureHurt') this.creatures.hurt(event.id);
  }

  draw(frame: PlayFrame): void {
    const { pose, eye } = frame;
    this.batch.begin(
      blockToColumn(pose.x) * SECTION_SIZE,
      blockToColumn(pose.y) * SECTION_SIZE,
      blockToColumn(pose.z) * SECTION_SIZE,
    );
    this.entities.drawPlayer(frame.player, frame.alpha, frame.dt, frame.avatarVisible);
    this.drops.drawAll(this.sim.entities, pose.x, pose.y, pose.z, frame.alpha, frame.dt);
    this.particles.update(frame.dt);
    // Creatures last: they share the room the bounded drops and particles leave, nearest first.
    const reach = this.view.reach;
    this.creatures.drawAll(this.sim.entities, pose.x, pose.z, reach, frame.alpha, frame.dt);
    this.batch.end();
    this.overlay.update(frame.targets);
    const light = this.sim.world.getLight(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
    this.hand.draw(
      frame.player,
      frame.dt,
      frame.firstPerson,
      skyOf(light) / 15,
      blockOf(light) / 15,
    );
  }

  /** Leaves the world view (which outlives a world) and frees the GPU objects. */
  dispose(): void {
    this.view.scene.remove(this.batch.mesh, this.overlay.group);
    this.view.attachHand(null);
    this.batch.dispose();
    this.overlay.dispose();
    this.hand.dispose();
  }
}
