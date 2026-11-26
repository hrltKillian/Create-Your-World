import { afterEach, describe, expect, it } from 'vitest';
import {
  AUDIO,
  AudioEngine,
  attenuation,
  pickVoice,
  type VoiceSlot,
} from '../../../src/audio/AudioEngine.ts';
import { LIMITER, WATER_FILTER } from '../../../src/audio/graph.ts';

const voice = (startedAt: number, endsAt: number, audibility: number): VoiceSlot => ({
  startedAt,
  endsAt,
  audibility,
});

/** Just enough of the Web Audio graph for the engine to build its buses and voices under Node. */
class FakeNode {
  readonly gain = { value: 1 };
  type = '';
  /** A filter's cutoff: the last target it glides to. */
  readonly frequency = {
    value: 0,
    setTargetAtTime(target: number) {
      this.value = target;
    },
  };
  normalize = true;
  /** Returns what it connects to, as Web Audio does (chains). */
  connect<T>(next?: T): T | this {
    return next ?? this;
  }
  disconnect(): void {}
}

class FakeContext {
  static made = 0;
  static last: FakeContext | null = null;
  state: AudioContextState = 'suspended';
  readonly currentTime = 0;
  readonly destination = new FakeNode();
  readonly listener = {};
  readonly filters: FakeNode[] = [];
  constructor() {
    FakeContext.made++;
    FakeContext.last = this;
  }
  /** The master limiter, its settings kept. */
  compressor: Record<string, { value: number }> | null = null;
  createDynamicsCompressor = () => {
    const params = {
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
    };
    this.compressor = params;
    return Object.assign(new FakeNode(), params);
  };
  createGain = () => new FakeNode();
  createConvolver = () => new FakeNode();
  createBiquadFilter = () => {
    const filter = new FakeNode();
    this.filters.push(filter);
    return filter;
  };
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }
}

const audioGlobals = globalThis as { AudioContext?: unknown; PannerNode?: unknown };

function installFakeAudio(): void {
  FakeContext.made = 0;
  audioGlobals.AudioContext = FakeContext;
  audioGlobals.PannerNode = FakeNode;
}

afterEach(() => {
  delete audioGlobals.AudioContext;
  delete audioGlobals.PannerNode;
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

  it('suspends while the tab is hidden and resumes after, never making a context itself', () => {
    installFakeAudio();
    const engine = new AudioEngine([], { muted: false });
    // Before the first click there is no context: hiding the tab creates none.
    engine.suspend();
    expect(engine.state()).toBe('idle');
    expect(FakeContext.made).toBe(0);
    engine.resume();
    expect(engine.state()).toBe('running');
    engine.suspend();
    expect(engine.state()).toBe('suspended');
    engine.resume();
    expect(engine.state()).toBe('running');
    expect(FakeContext.made).toBe(1);
    const muted = new AudioEngine([], { muted: true });
    muted.resume();
    muted.suspend();
    expect(muted.state()).toBe('muted');
    expect(FakeContext.made).toBe(1);
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

  it('logs local sounds and loops as they start, and counts every key ever logged', () => {
    let clock = 0;
    const engine = new AudioEngine([], { muted: true, now: () => clock });
    expect(engine.playLocal('sfx:jump')).toBe(true);
    expect(engine.playLocal('sfx:jump')).toBe(false);
    engine.setLoop('sfx:amb_wind', 0.2);
    engine.setLoop('sfx:amb_wind', 0.6);
    expect(engine.ambience()).toEqual([{ key: 'sfx:amb_wind', gain: 0.6 }]);
    engine.setLoop('sfx:amb_wind', 0);
    expect(engine.ambience()).toEqual([]);
    engine.setLoop('sfx:amb_wind', 0.1);
    expect(engine.log()).toEqual(['sfx:jump', 'sfx:amb_wind', 'sfx:amb_wind']);
    for (let i = 0; i < AUDIO.logSize; i++) {
      clock += AUDIO.dedupMs;
      engine.playUi('sfx:click');
    }
    expect(engine.logCount()).toBe(AUDIO.logSize + 3);
  });

  it('muffles effects and ambience under water, now or once the context exists', () => {
    installFakeAudio();
    const engine = new AudioEngine([], { muted: false });
    engine.setUnderwater(true);
    expect(engine.underwater()).toBe(true);
    engine.resume();
    const water = FakeContext.last!.filters[0]!;
    expect(water.type).toBe('lowpass');
    expect(water.frequency.value).toBe(WATER_FILTER.underwaterHz);
    engine.setUnderwater(false);
    expect(water.frequency.value).toBe(WATER_FILTER.openHz);
  });

  it('limits the mix hard and fast (plan v5 « M53 »)', () => {
    installFakeAudio();
    new AudioEngine([], { muted: false }).resume();
    const limiter = FakeContext.last!.compressor!;
    expect(limiter.threshold!.value).toBe(LIMITER.threshold);
    expect(limiter.ratio!.value).toBeGreaterThanOrEqual(20);
    expect(limiter.attack!.value).toBeLessThan(0.01);
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
