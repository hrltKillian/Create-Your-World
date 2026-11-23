import { describe, expect, it } from 'vitest';
import { AudioCues, type CuePlayer } from '../../../src/audio/cues.ts';
import type { SimEvent } from '../../../src/sim/events.ts';

class FakePlayer implements CuePlayer {
  readonly calls: { key: string; x: number; pitch: number }[] = [];
  play(key: string, x: number, _y: number, _z: number, pitch = 1): boolean {
    this.calls.push({ key, x, pitch });
    return true;
  }
}

const sound = (sfx: string, x = 0): SimEvent => ({ type: 'sound', sfx, x, y: 64, z: 0 });

describe('AudioCues', () => {
  it('plays sound events at their position and ignores the others', () => {
    const player = new FakePlayer();
    const cues = new AudioCues(player, 'sfx:pickup', () => 0);
    cues.onEvent(sound('sfx:break_soil', 3.5));
    cues.onEvent({ type: 'blockBroken', playerId: 1, x: 3, y: 64, z: 0, state: 5 });
    cues.onEvent({ type: 'inventoryChanged', playerId: 1 });
    expect(player.calls).toEqual([{ key: 'sfx:break_soil', x: 3.5, pitch: 1 }]);
  });

  it('raises the pitch of a series of pickups, and starts over after a pause', () => {
    const player = new FakePlayer();
    let clock = 0;
    const cues = new AudioCues(player, 'sfx:pickup', () => clock);
    for (let i = 0; i < 3; i++) {
      cues.onEvent(sound('sfx:pickup'));
      clock += 100;
    }
    clock += 1000;
    cues.onEvent(sound('sfx:pickup'));
    const pitches = player.calls.map((c) => c.pitch);
    expect(pitches[0]).toBe(1);
    expect(pitches[1]).toBeGreaterThan(pitches[0]!);
    expect(pitches[2]).toBeGreaterThan(pitches[1]!);
    expect(pitches[3]).toBe(1);
  });
});
