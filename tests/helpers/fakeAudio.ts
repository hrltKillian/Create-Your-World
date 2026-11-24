import type { LoopPlayer } from '../../src/audio/Ambience.ts';
import type { CuePlayer } from '../../src/audio/cues.ts';

/** Records every play (`at`: 'world' with its x, 'local' or 'ui') and every loop gain set. */
export class FakePlayer implements CuePlayer, LoopPlayer {
  readonly calls: { key: string; at: string; x: number; pitch: number }[] = [];
  /** The gain of each loop as last set (0: stopped). */
  readonly loops = new Map<string, number>();

  play(key: string, x: number, _y: number, _z: number, pitch = 1): boolean {
    this.calls.push({ key, at: 'world', x, pitch });
    return true;
  }
  playLocal(key: string, pitch = 1): boolean {
    this.calls.push({ key, at: 'local', x: 0, pitch });
    return true;
  }
  playUi(key: string, pitch = 1): boolean {
    this.calls.push({ key, at: 'ui', x: 0, pitch });
    return true;
  }
  setLoop(key: string, gain: number): void {
    this.loops.set(key, gain);
  }

  keys(): string[] {
    return this.calls.map((c) => c.key);
  }
  /** The loops sounding now (gain > 0). */
  sounding(): string[] {
    return [...this.loops].filter(([, gain]) => gain > 0).map(([key]) => key);
  }
}
