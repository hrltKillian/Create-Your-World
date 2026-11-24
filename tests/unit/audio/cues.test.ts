import { describe, expect, it } from 'vitest';
import { AudioCues, consumeSound, LAND_MIN_FALL } from '../../../src/audio/cues.ts';
import type { SimEvent } from '../../../src/sim/events.ts';
import { FakePlayer } from '../../helpers/fakeAudio.ts';
import { registry } from '../../helpers/registry.ts';

const sounds = registry.pack.sounds!;
const ME = 1;

function cues(clock: () => number = () => 0) {
  const player = new FakePlayer();
  return { player, cues: new AudioCues(player, registry, ME, clock) };
}

const sound = (sfx: string, x = 0): SimEvent => ({ type: 'sound', sfx, x, y: 64, z: 0 });

describe('AudioCues', () => {
  it('plays sound events at their position and ignores the others', () => {
    const { player, cues: c } = cues();
    c.onEvent(sound('sfx:break_soil', 3.5));
    c.onEvent({ type: 'blockBroken', playerId: ME, x: 3, y: 64, z: 0, state: 5 });
    c.onEvent({ type: 'inventoryChanged', playerId: ME });
    expect(player.calls).toEqual([{ key: 'sfx:break_soil', at: 'world', x: 3.5, pitch: 1 }]);
  });

  it('raises the pitch of a series of pickups, and starts over after a pause', () => {
    let clock = 0;
    const { player, cues: c } = cues(() => clock);
    for (let i = 0; i < 3; i++) {
      c.onEvent(sound(sounds.pickup));
      clock += 100;
    }
    clock += 1000;
    c.onEvent(sound(sounds.pickup));
    const pitches = player.calls.map((call) => call.pitch);
    expect(pitches[0]).toBe(1);
    expect(pitches[1]).toBeGreaterThan(pitches[0]!);
    expect(pitches[2]).toBeGreaterThan(pitches[1]!);
    expect(pitches[3]).toBe(1);
  });

  it("maps the local player's jumps, landings, meals, drinks, crafts and death to their sounds", () => {
    const { player, cues: c } = cues();
    const events: SimEvent[] = [
      { type: 'playerJumped', playerId: ME },
      { type: 'playerLanded', playerId: ME, fall: 1.2 },
      { type: 'consumed', playerId: ME, item: 'item:berries' },
      { type: 'consumed', playerId: ME, item: 'item:flask_boiled' },
      { type: 'consumed', playerId: ME, item: 'block:fresh_water' },
      { type: 'crafted', playerId: ME, recipe: 'recipe:cord', item: 'item:cord', count: 1 },
      { type: 'died', playerId: ME, cause: 'fall', x: 0, y: 64, z: 0, pack: false },
    ];
    for (const event of events) c.onEvent(event);
    const p = sounds.player;
    expect(player.keys()).toEqual([p.jump, p.land, p.eat, p.drink, p.drink, sounds.craft, p.death]);
    const buses = player.calls.map((call) => call.at);
    expect(buses).toEqual(['local', 'local', 'local', 'local', 'local', 'ui', 'local']);
  });

  it('lands only past a step down, and hurts past the safe fall', () => {
    const { player, cues: c } = cues();
    const safe = registry.pack.balance.fall.safeBlocks;
    for (const fall of [LAND_MIN_FALL / 2, LAND_MIN_FALL, safe, safe + 1])
      c.onEvent({ type: 'playerLanded', playerId: ME, fall });
    const { land } = sounds.player;
    expect(player.keys()).toEqual([land, land, land, sounds.combat.hurt]);
  });

  it("stays silent for another player's own sounds", () => {
    const { player, cues: c } = cues();
    c.onEvent({ type: 'playerJumped', playerId: 2 });
    c.onEvent({ type: 'consumed', playerId: 2, item: 'item:berries' });
    c.onEvent({ type: 'crafted', playerId: 2, recipe: 'recipe:cord', item: 'item:cord', count: 1 });
    expect(player.calls).toEqual([]);
  });

  it('opens and closes a chest at its cell, a station without a sound', () => {
    const { player, cues: c } = cues();
    c.onEvent({ type: 'blockEntityOpened', playerId: ME, kind: 'container', x: 4, y: 65, z: 0 });
    c.onEvent({ type: 'blockEntityClosed', playerId: ME });
    c.onEvent({ type: 'blockEntityOpened', playerId: ME, kind: 'station', x: 8, y: 65, z: 0 });
    c.onEvent({ type: 'blockEntityClosed', playerId: ME });
    expect(player.calls).toEqual([
      { key: sounds.chest.open, at: 'world', x: 4.5, pitch: 1 },
      { key: sounds.chest.close, at: 'world', x: 4.5, pitch: 1 },
    ]);
  });

  it('sounds the stingers of dusk and dawn', () => {
    const { player, cues: c } = cues();
    c.onEvent({ type: 'sunset', day: 1 });
    c.onEvent({ type: 'nightSurvived', night: 1 });
    expect(player.keys()).toEqual([sounds.clock.dusk, sounds.clock.dawn]);
  });
});

describe('consumeSound', () => {
  it('drinks sipped liquids, containers and teas; eats food, juicy fruit included', () => {
    expect(consumeSound(registry, 'block:fresh_water')).toBe('drink');
    expect(consumeSound(registry, 'item:flask_boiled')).toBe('drink');
    expect(consumeSound(registry, 'item:antidote_tea')).toBe('drink');
    expect(consumeSound(registry, 'item:berries')).toBe('eat');
    expect(consumeSound(registry, 'item:palmthorn_fruit')).toBe('eat');
  });
});
