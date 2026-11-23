import type { SfxDef, SfxLayer } from '../../content/schema.ts';
import { sfxSeconds } from '../../content/validateSounds.ts';
import { fnv1aString, hashUnit } from '../../core/hash.ts';

/** Sample rate of the pre-rendered sounds (the AudioContext resamples if it differs). */
export const SFX_SAMPLE_RATE = 44_100;
/** Level the exponential decay ends at (−60 dB): exponential ramps cannot reach 0. */
const SILENCE = 0.001;

/**
 * Renders a recipe into a mono AudioBuffer with an OfflineAudioContext (browser only). The noise
 * is seeded by the sound key, so a recipe always renders the same samples.
 */
export function renderSfx(def: SfxDef, sampleRate = SFX_SAMPLE_RATE): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil(sfxSeconds(def) * sampleRate));
  const ctx = new OfflineAudioContext(1, length, sampleRate);
  const seed = fnv1aString(def.key);
  def.layers.forEach((layer, i) => {
    addLayer(ctx, layer, seed + i);
  });
  return ctx.startRendering();
}

/** Source → filter → envelope → destination, for one layer. */
function addLayer(ctx: OfflineAudioContext, layer: SfxLayer, seed: number): void {
  const start = layer.delay ?? 0;
  const peak = start + layer.attack;
  const end = peak + layer.decay;
  let source: AudioScheduledSourceNode;
  if (layer.source === 'noise') {
    const buffer = ctx.createBuffer(1, Math.ceil((end - start) * ctx.sampleRate), ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = hashUnit(seed, i) * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    source = noise;
  } else {
    const osc = ctx.createOscillator();
    osc.type = layer.source;
    const [from, to] = layer.freq ?? [440, 440];
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(to, end);
    source = osc;
  }
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(layer.gain, peak);
  envelope.gain.exponentialRampToValueAtTime(layer.gain * SILENCE, end);
  let tail: AudioNode = source;
  if (layer.filter) {
    const filter = ctx.createBiquadFilter();
    filter.type = layer.filter.type;
    filter.frequency.value = layer.filter.freq;
    filter.Q.value = layer.filter.q ?? 1;
    tail = tail.connect(filter);
  }
  tail.connect(envelope).connect(ctx.destination);
  source.start(start);
  source.stop(end);
}
