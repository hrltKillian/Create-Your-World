import type { Registry } from '../content/registry.ts';
import type { SoundBindings } from '../content/schema.ts';
import type { SimEvent } from '../sim/events.ts';

/** The part of the engine the cues use (a fake in tests). */
export interface CuePlayer {
  play(key: string, x: number, y: number, z: number, pitch?: number): boolean;
  /** The local player's own sounds, at the ear. */
  playLocal(key: string, pitch?: number): boolean;
  playUi(key: string, pitch?: number): boolean;
}

/** Pickups closer together than this (ms) form a series whose pitch rises. */
const SERIES_MS = 600;
/** One semitone up per pickup of a series, at most an octave. */
const SEMITONE = 2 ** (1 / 12);
const SERIES_MAX = 12;
/** A shorter drop (a slab, a step down) sounds like a footstep, not a landing (blocks). */
export const LAND_MIN_FALL = 0.6;

/**
 * Whether consuming `item` sounds like eating or drinking: a sipped liquid (its block key), a
 * water container's charge, or an item that quenches without feeding (a tea), is a drink.
 */
export function consumeSound(registry: Registry, item: string): 'eat' | 'drink' {
  const def = registry.item(item);
  if (!def || def.container) return 'drink';
  const c = def.consume;
  return (c?.thirst ?? 0) > 0 && !c?.hunger ? 'drink' : 'eat';
}

/**
 * Event-to-audio bridge. The simulation turns breaking, hitting, placing, picking up, blows and
 * doors into `sound` events at world positions, played as they are, with the rising pitch of a
 * series of pickups. The other events take their sounds from the pack's bindings: chests opening
 * and closing at their cell (any player's), the local player's jumps, landings (with the hurt sound
 * past the balance's safe fall), meals, drinks, swings and death at the ear, a craft on the
 * interface bus, and the bell of dusk and dawn.
 */
export class AudioCues {
  private readonly player: CuePlayer;
  private readonly registry: Registry;
  private readonly sounds: SoundBindings | undefined;
  private readonly playerId: number;
  /** Falls longer than this (blocks) take health (`balance.fall.safeBlocks`). */
  private readonly safeFall: number;
  private readonly now: () => number;
  /** The chest each player has open (its cell centre), for the closing sound. */
  private readonly chests = new Map<number, { x: number; y: number; z: number }>();
  private lastPickup = Number.NEGATIVE_INFINITY;
  private series = 0;

  constructor(player: CuePlayer, registry: Registry, playerId: number, now?: () => number) {
    this.player = player;
    this.registry = registry;
    this.sounds = registry.pack.sounds;
    this.playerId = playerId;
    this.safeFall = registry.pack.balance.fall.safeBlocks;
    this.now = now ?? (() => performance.now());
  }

  onEvent(event: SimEvent): void {
    if (event.type === 'sound') {
      const pitch = event.sfx === this.sounds?.pickup ? this.pickupPitch() : 1;
      this.player.play(event.sfx, event.x, event.y, event.z, pitch);
      return;
    }
    const s = this.sounds;
    if (!s) return;
    switch (event.type) {
      case 'blockEntityOpened':
        if (event.kind === 'container') this.chestOpened(event.playerId, event, s.chest.open);
        else this.chests.delete(event.playerId);
        return;
      case 'blockEntityClosed':
        this.chestClosed(event.playerId, s.chest.close);
        return;
      case 'sunset':
        this.player.playLocal(s.clock.dusk);
        return;
      case 'nightSurvived':
        this.player.playLocal(s.clock.dawn);
        return;
      case 'workbenchCrafted':
        // The bench's own chime, heard around it.
        this.player.play(s.ui.craft, event.x + 0.5, event.y + 0.5, event.z + 0.5);
        return;
    }
    if (!('playerId' in event) || event.playerId !== this.playerId) return;
    switch (event.type) {
      case 'playerJumped':
        this.player.playLocal(s.player.jump);
        return;
      case 'playerLanded':
        if (event.fall >= LAND_MIN_FALL) this.player.playLocal(s.player.land);
        if (event.fall > this.safeFall) this.player.playLocal(s.combat.hurt);
        return;
      case 'consumed':
        this.player.playLocal(s.player[consumeSound(this.registry, event.item)]);
        return;
      case 'crafted':
        this.player.playUi(s.ui.craft);
        return;
      case 'playerSwung':
        this.player.playLocal(s.player.swing);
        return;
      case 'died':
        this.player.playLocal(s.player.death);
        return;
    }
  }

  private chestOpened(playerId: number, cell: { x: number; y: number; z: number }, key: string) {
    const at = { x: cell.x + 0.5, y: cell.y + 0.5, z: cell.z + 0.5 };
    this.chests.set(playerId, at);
    this.player.play(key, at.x, at.y, at.z);
  }

  private chestClosed(playerId: number, key: string): void {
    const at = this.chests.get(playerId);
    if (!at) return;
    this.chests.delete(playerId);
    this.player.play(key, at.x, at.y, at.z);
  }

  private pickupPitch(): number {
    const now = this.now();
    this.series = now - this.lastPickup < SERIES_MS ? Math.min(SERIES_MAX, this.series + 1) : 0;
    this.lastPickup = now;
    return SEMITONE ** this.series;
  }
}
