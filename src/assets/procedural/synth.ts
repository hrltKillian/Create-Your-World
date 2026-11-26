import type { SfxDef, SfxLayer } from '../../content/schema.ts';
import { sfxSeconds } from '../../content/validateSounds.ts';
import { fnv1aString, hashUnit } from '../../core/hash.ts';

/**
 * The sound synthesizer (plan v4 « M44 »), sample by sample and pure: a recipe always gives the
 * same samples, in the browser and under Node (tests). Each layer is a source (noise, a tone
 * gliding between two pitches, resonant modes struck at once, or a stream of short grains),
 * through an optional biquad filter, shaped by a linear attack, a hold and an exponential decay;
 * the layers are mixed and the mix kept under full scale.
 */

/** Sample rate of the rendered sounds (the AudioContext resamples if it differs). */
export const SFX_SAMPLE_RATE = 44_100;
/** Level the exponential decay ends at (−60 dB). */
const SILENCE = 0.001;
/** The mix's highest peak: a little under full scale, so nothing clips. */
export const PEAK = 0.95;
/** ln(1000): a mode's amplitude falls by 60 dB over its ring time. */
const RING = Math.log(1000);
const TAU = Math.PI * 2;

/** Renders a recipe into mono samples at `rate`. */
export function synthesize(def: SfxDef, rate = SFX_SAMPLE_RATE): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.max(1, Math.ceil(sfxSeconds(def) * rate)));
  const seed = fnv1aString(def.key);
  def.layers.forEach((layer, i) => {
    addLayer(out, layer, seed + i, rate);
  });
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]!));
  if (peak > PEAK) for (let i = 0; i < out.length; i++) out[i] = (out[i]! * PEAK) / peak;
  return out;
}

/** One layer's source, filter and envelope, added into `out`. */
function addLayer(out: Float32Array, layer: SfxLayer, seed: number, rate: number): void {
  const start = Math.round((layer.delay ?? 0) * rate);
  const attack = Math.max(1, Math.round(layer.attack * rate));
  const hold = Math.round((layer.hold ?? 0) * rate);
  const decay = Math.max(1, Math.round(layer.decay * rate));
  const length = Math.min(attack + hold + decay, out.length - start);
  if (length <= 0) return;
  const samples = new Float32Array(length);
  source(samples, layer, seed, rate);
  if (layer.filter)
    biquad(samples, layer.filter.type, layer.filter.freq, layer.filter.q ?? 1, rate);
  // Linear up, held, then down by a constant factor a sample to SILENCE at the end.
  const fall = SILENCE ** (1 / decay);
  let env = 0;
  for (let i = 0; i < length; i++) {
    if (i < attack) env = i / attack;
    else if (i < attack + hold || i === attack) env = 1;
    else env *= fall;
    out[start + i] = out[start + i]! + samples[i]! * env * layer.gain;
  }
}

function source(samples: Float32Array, layer: SfxLayer, seed: number, rate: number): void {
  const kind = layer.source;
  if (kind === 'noise') {
    for (let i = 0; i < samples.length; i++) samples[i] = hashUnit(seed, i) * 2 - 1;
  } else if (kind === 'modal') modes(samples, layer.modes ?? [], seed, rate);
  else if (kind === 'grains') grains(samples, layer, seed, rate);
  else tone(samples, kind, layer.freq ?? [440, 440], rate, layer.vibrato);
}

/**
 * A tone gliding exponentially from one pitch to the other, wavering by `vibrato` (rate in Hz,
 * depth in semitones); band-limited edges (polyBLEP).
 */
function tone(
  samples: Float32Array,
  wave: 'sine' | 'triangle' | 'square' | 'sawtooth',
  [from, to]: readonly [number, number],
  rate: number,
  vibrato?: { readonly rate: number; readonly depth: number },
): void {
  let phase = 0;
  let tri = 0;
  const waver = vibrato ? vibrato.depth / 12 : 0;
  const speed = vibrato ? (TAU * vibrato.rate) / rate : 0;
  for (let i = 0; i < samples.length; i++) {
    const glide = from * (to / from) ** (i / samples.length);
    const f = waver === 0 ? glide : glide * 2 ** (waver * Math.sin(speed * i));
    const dt = f / rate;
    let v: number;
    if (wave === 'sine') v = Math.sin(phase * TAU);
    else if (wave === 'sawtooth') v = 2 * phase - 1 - blep(phase, dt);
    else {
      // A square, and the triangle as its leaky integral.
      v = (phase < 0.5 ? 1 : -1) + blep(phase, dt) - blep((phase + 0.5) % 1, dt);
      if (wave === 'triangle') {
        tri = dt * v * 4 + (1 - dt) * tri;
        v = tri;
      }
    }
    samples[i] = v;
    phase += dt;
    phase -= Math.floor(phase);
  }
}

/** The polyBLEP correction of a step at phase 0 (dt: the phase step a sample). */
function blep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** Resonant modes struck at the start: frequency (Hz), ring time to −60 dB (s), gain. */
function modes(
  samples: Float32Array,
  list: readonly (readonly [number, number, number])[],
  seed: number,
  rate: number,
): void {
  list.forEach(([freq, ring, gain], m) => {
    const phase = hashUnit(seed, m, 9) * TAU;
    const fall = Math.exp(-RING / (ring * rate));
    let amp = gain;
    for (let i = 0; i < samples.length; i++) {
      samples[i] = samples[i]! + amp * Math.sin((TAU * freq * i) / rate + phase);
      amp *= fall;
    }
  });
}

/**
 * A stream of short grains (crunch, rustle, patter): `rate` a second on average, each a windowed
 * burst `seconds` long (min, max), of noise or, with `tone`, of a pitch falling from a frequency
 * in that range (a drop's plip).
 */
function grains(samples: Float32Array, layer: SfxLayer, seed: number, rate: number): void {
  const g = layer.grains;
  if (!g || g.rate <= 0) return;
  let at = 0;
  for (let k = 0; ; k++) {
    // Exponential gaps: grains at random times, `g.rate` a second on average.
    at += (-Math.log(1 - hashUnit(seed, k, 1) * 0.999) / g.rate) * rate;
    const start = Math.floor(at);
    if (start >= samples.length) return;
    const span = g.seconds[0] + (g.seconds[1] - g.seconds[0]) * hashUnit(seed, k, 2);
    const n = Math.max(2, Math.round(span * rate));
    const amp = 0.4 + 0.6 * hashUnit(seed, k, 3);
    const f0 = g.tone ? g.tone[0] + (g.tone[1] - g.tone[0]) * hashUnit(seed, k, 4) : 0;
    let phase = 0;
    for (let i = 0; i < n && start + i < samples.length; i++) {
      const window = 0.5 - 0.5 * Math.cos((TAU * i) / (n - 1));
      let v: number;
      if (g.tone) {
        phase += (f0 * (1 - (0.4 * i) / n)) / rate;
        v = Math.sin(phase * TAU);
      } else v = hashUnit(seed, k, i + 5) * 2 - 1;
      samples[start + i] = samples[start + i]! + v * window * amp;
    }
  }
}

/** A biquad filter (the RBJ cookbook's), in place. */
export function biquad(
  samples: Float32Array,
  type: 'lowpass' | 'highpass' | 'bandpass',
  freq: number,
  q: number,
  rate: number,
): void {
  const w = (TAU * Math.min(freq, rate * 0.45)) / rate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b0: number;
  let b1: number;
  let b2: number;
  if (type === 'lowpass') {
    b1 = 1 - cos;
    b0 = b1 / 2;
    b2 = b0;
  } else if (type === 'highpass') {
    b1 = -(1 + cos);
    b0 = (1 + cos) / 2;
    b2 = b0;
  } else {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  }
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]!;
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    samples[i] = y;
  }
}
