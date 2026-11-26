import type { AmbiencePlace } from '../audio/Ambience.ts';
import type { LoopView } from '../audio/loops.ts';
import type { ReverbPlace } from '../audio/reverb.ts';
import type { App } from './App.ts';

/**
 * Audio automation (M11) shared by the debug hook and the selftests: what was heard since a mark
 * of the log, and the ambience (its loops, the place they were chosen for, the underwater
 * low-pass).
 */

/** A mark in the audio log: how many keys it ever logged (`heardSince` reads what came after). */
export function audioMark(app: App): number {
  return app.audio?.logCount() ?? 0;
}

/** The keys logged after a mark, oldest first (at most the log's last AUDIO.logSize). */
export function heardSince(app: App, mark: number): string[] {
  const audio = app.audio;
  const count = audio ? audio.logCount() - mark : 0;
  return audio && count > 0 ? audio.log().slice(-count) : [];
}

/** The ambience as automation reads it. */
export interface AmbienceView {
  /** The loops playing or fading, with their gains (0–1, before the ambience volume). */
  readonly loops: LoopView[];
  /** The camera is in water: effects and ambience go through the low-pass. */
  readonly underwater: boolean;
  /** Where the loops were chosen on the last frame (null without an open world). */
  readonly place: AmbiencePlace | null;
  /** The room the effects ring in (plan v4 « M44 »), null before the first. */
  readonly reverb: ReverbPlace | null;
}

/** The ambience now (null without an audio engine). */
export function ambienceView(app: App): AmbienceView | null {
  const audio = app.audio;
  if (!audio) return null;
  const place = app.game?.open?.sounds.ambiencePlace();
  return {
    loops: audio.ambience(),
    underwater: audio.underwater(),
    place: place ? { ...place } : null,
    reverb: audio.reverb(),
  };
}
