import type { SfxDef } from '../../content/schema.ts';
import { SFX_SAMPLE_RATE, synthesize } from './synth.ts';

export { SFX_SAMPLE_RATE } from './synth.ts';

/** Renders a recipe into a mono AudioBuffer (browser only): the samples of `synthesize`. */
export function renderSfx(def: SfxDef, sampleRate = SFX_SAMPLE_RATE): AudioBuffer {
  const samples = synthesize(def, sampleRate);
  const buffer = new AudioBuffer({ length: samples.length, sampleRate, numberOfChannels: 1 });
  buffer.copyToChannel(samples, 0);
  return buffer;
}
