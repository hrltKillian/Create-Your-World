import type { SfxDef } from '../../content/schema.ts';
import { SFX_SAMPLE_RATE, synthesize } from './synth.ts';

export { SFX_SAMPLE_RATE } from './synth.ts';

/** Renders a recipe's variant into a mono AudioBuffer (browser only): `synthesize`'s samples. */
export function renderSfx(def: SfxDef, sampleRate = SFX_SAMPLE_RATE, variant = 0): AudioBuffer {
  const samples = synthesize(def, sampleRate, variant);
  const buffer = new AudioBuffer({ length: samples.length, sampleRate, numberOfChannels: 1 });
  buffer.copyToChannel(samples, 0);
  return buffer;
}
