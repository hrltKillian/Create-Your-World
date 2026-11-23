import { describe, expect, it } from 'vitest';
import {
  AUDIO,
  AudioEngine,
  attenuation,
  pickVoice,
  type VoiceSlot,
} from '../../../src/audio/AudioEngine.ts';

const voice = (startedAt: number, endsAt: number, audibility: number): VoiceSlot => ({
  startedAt,
  endsAt,
  audibility,
});

describe('AudioEngine', () => {
  it('logs every accepted play, muted or before any gesture', () => {
    let clock = 1000;
    const engine = new AudioEngine([], { muted: true, now: () => clock });
    engine.setListener(10, 64, 10, 0, 0);
    expect(engine.state()).toBe('muted');
    expect(engine.play('sfx:break_soil', 11, 64, 10)).toBe(true);
    // The same sound within 30 ms is a duplicate; another sound is not.
    clock += AUDIO.dedupMs - 1;
    expect(engine.play('sfx:break_soil', 11, 64, 10)).toBe(false);
    expect(engine.playUi('sfx:click')).toBe(true);
    clock += 1;
    expect(engine.play('sfx:break_soil', 11, 64, 10)).toBe(true);
    expect(engine.log()).toEqual(['sfx:break_soil', 'sfx:click', 'sfx:break_soil']);
    expect(new AudioEngine([], { muted: false }).state()).toBe('idle');
  });

  it('does not play sounds farther than 32 m from the listener', () => {
    const engine = new AudioEngine([], { muted: true, now: () => 0 });
    engine.setListener(0, 64, 0, 0, 0);
    expect(engine.play('sfx:hit_stone', 0, 64, AUDIO.far + 0.5)).toBe(false);
    expect(engine.play('sfx:hit_stone', 0, 64, AUDIO.far - 0.5)).toBe(true);
    expect(engine.log()).toEqual(['sfx:hit_stone']);
  });

  it('keeps only the last keys in its log', () => {
    let clock = 0;
    const engine = new AudioEngine([], { muted: true, now: () => clock });
    for (let i = 0; i < AUDIO.logSize + 10; i++) {
      clock += AUDIO.dedupMs;
      engine.playUi('sfx:click');
    }
    expect(engine.log()).toHaveLength(AUDIO.logSize);
  });

  it('attenuates linearly from 2 m to 32 m', () => {
    expect(attenuation(0)).toBe(1);
    expect(attenuation(AUDIO.near)).toBe(1);
    expect(attenuation((AUDIO.near + AUDIO.far) / 2)).toBeCloseTo(0.5);
    expect(attenuation(AUDIO.far)).toBe(0);
  });

  it('takes a free voice, else steals the least audible, then the oldest', () => {
    expect(pickVoice([voice(0, 500, 1), voice(0, 90, 1), voice(0, 50, 1)], 100)).toBe(1);
    expect(pickVoice([voice(0, 500, 0.9), voice(10, 500, 0.2), voice(20, 500, 0.5)], 100)).toBe(1);
    expect(pickVoice([voice(30, 500, 0.4), voice(10, 500, 0.4), voice(20, 500, 0.4)], 100)).toBe(1);
  });
});
