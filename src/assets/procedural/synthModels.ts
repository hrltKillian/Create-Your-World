import type { SfxLayer } from '../../content/schema.ts';
import { hashUnit } from '../../core/hash.ts';

/*
 * The models of real sounds (plan v5 « M53 », decision 32), sample by sample and pure: each fills
 * `samples` (one layer's length) from the layer's fields and a seed. Noise in three colours, a body
 * struck through a contact (modal synthesis), bubbles at their Minnaert pitch, the pops of a fire,
 * turbulent air in gusts and a voice (glottal pulses through formants).
 */

const TAU = Math.PI * 2;
/** ln(1000): an amplitude falls by 60 dB over a ring time. */
const RING = Math.log(1000);

/** A white noise sample in [−1, 1]. */
function white(seed: number, i: number): number {
  return hashUnit(seed, i) * 2 - 1;
}

/** White noise, or pink (−3 dB an octave: Paul Kellet's filter) or brown (−6 dB: leaky sum). */
export function colouredNoise(
  samples: Float32Array,
  colour: 'noise' | 'pink' | 'brown',
  seed: number,
): void {
  let [b0, b1, b2, b3, b4, b5, b6] = [0, 0, 0, 0, 0, 0, 0];
  let brown = 0;
  for (let i = 0; i < samples.length; i++) {
    const w = white(seed, i);
    if (colour === 'noise') samples[i] = w;
    else if (colour === 'brown') {
      brown = (brown + 0.02 * w) / 1.02;
      samples[i] = brown * 3.5;
    } else {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      samples[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
}

/**
 * How much of a mode at `freq` a contact `seconds` long excites: the spectrum of a raised-cosine
 * force pulse, 1 for a mode far below 1 / seconds, nearly nothing far above it.
 */
export function contactSpectrum(freq: number, seconds: number): number {
  const x = freq * seconds;
  if (x < 1e-6) return 1;
  if (Math.abs(x - 1) < 1e-6) return 0.5;
  const sinc = Math.sin(Math.PI * x) / (Math.PI * x);
  return Math.abs(sinc / (1 - x * x));
}

/**
 * A body struck (modal synthesis): its modes ring from the blow, each as much as the contact's
 * length lets it (`contactSpectrum`), over the click of the contact itself, a burst of noise as
 * long as the contact and as bright as it is short.
 */
export function impact(samples: Float32Array, layer: SfxLayer, seed: number, rate: number): void {
  const contact = Math.max(1 / rate, layer.contact ?? 0.002);
  const n = Math.min(samples.length, Math.max(2, Math.round(contact * rate)));
  // The click: noise under a raised-cosine pulse, through a one-pole low-pass at about 1 / contact.
  const k = Math.min(1, (TAU * 0.5) / (contact * rate));
  let low = 0;
  for (let i = 0; i < n; i++) {
    const pulse = 0.5 - 0.5 * Math.cos((TAU * i) / (n - 1));
    low += k * (white(seed, i) - low);
    samples[i] = samples[i]! + 0.6 * low * pulse;
  }
  (layer.modes ?? []).forEach(([freq, ring, gain], m) => {
    const amp0 = gain * contactSpectrum(freq, contact);
    if (amp0 < 1e-4) return;
    const fall = Math.exp(-RING / (ring * rate));
    const phase = hashUnit(seed, m, 9) * TAU;
    let amp = amp0;
    for (let i = 0; i < samples.length && amp > 1e-5; i++) {
      // The mode builds up over the contact, then rings down.
      const rise = i < n ? 0.5 - 0.5 * Math.cos((Math.PI * i) / n) : 1;
      samples[i] = samples[i]! + amp * rise * Math.sin((TAU * freq * i) / rate + phase);
      amp *= fall;
    }
  });
}

/**
 * Bubbles (Minnaert; van den Doel's model): each, at a random time, rings at 3.26 kHz·mm over its
 * radius, its pitch rising as it closes, damped faster the smaller it is; larger ones louder.
 */
export function bubbles(samples: Float32Array, layer: SfxLayer, seed: number, rate: number): void {
  const b = layer.bubbles;
  if (!b || b.rate <= 0) return;
  let at = 0;
  for (let k = 0; ; k++) {
    at += (-Math.log(1 - hashUnit(seed, k, 1) * 0.999) / b.rate) * rate;
    const start = Math.floor(at);
    if (start >= samples.length) return;
    // Radii spread evenly on a log scale between the two.
    const r = b.radius[0] * (b.radius[1] / b.radius[0]) ** hashUnit(seed, k, 2);
    const f0 = 3260 / r;
    const damping = 0.043 * f0 + 0.0014 * f0 ** 1.5;
    const rise = 0.1 * damping;
    const amp = (r / b.radius[1]) * (0.5 + 0.5 * hashUnit(seed, k, 3));
    const n = Math.min(samples.length - start, Math.ceil((RING / damping) * rate));
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      phase += (f0 * (1 + rise * t)) / rate;
      samples[start + i] =
        samples[start + i]! + amp * Math.exp(-damping * t) * Math.sin(TAU * phase);
    }
  }
}

/**
 * The pops of a fire: at random times, each a click ringing a few milliseconds at a pitch within
 * `freq`, their sizes drawn from a power law (a few loud cracks among many small ticks).
 */
export function crackle(samples: Float32Array, layer: SfxLayer, seed: number, rate: number): void {
  const c = layer.crackle;
  if (!c || c.rate <= 0) return;
  let at = 0;
  for (let k = 0; ; k++) {
    at += (-Math.log(1 - hashUnit(seed, k, 1) * 0.999) / c.rate) * rate;
    const start = Math.floor(at);
    if (start >= samples.length) return;
    const size = Math.min(1, 0.08 / (1 - hashUnit(seed, k, 2) * 0.999) ** 0.6);
    const freq = c.freq[0] * (c.freq[1] / c.freq[0]) ** hashUnit(seed, k, 3);
    const ring = 0.002 + 0.006 * hashUnit(seed, k, 4);
    const n = Math.min(samples.length - start, Math.ceil(ring * rate));
    const sign = hashUnit(seed, k, 5) < 0.5 ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const fade = Math.exp((-RING * i) / n);
      const click = i < 3 ? white(seed + k, i) : 0;
      samples[start + i] =
        samples[start + i]! + sign * size * fade * (Math.sin((TAU * freq * i) / rate) + click);
    }
  }
}

/** A smooth random curve in [0, 1] through a value every `1 / rate` s (cosine-eased). */
function wander(seed: number, t: number, rate: number): number {
  const x = t * rate;
  const i = Math.floor(x);
  const f = x - i;
  const ease = 0.5 - 0.5 * Math.cos(Math.PI * f);
  return hashUnit(seed, i, 7) * (1 - ease) + hashUnit(seed, i + 1, 7) * ease;
}

/**
 * Turbulent air: pink and brown noise through a resonant band-pass (a state-variable filter)
 * whose centre wanders within `band` as the gusts blow, the level rising with them by `depth`.
 */
export function wind(samples: Float32Array, layer: SfxLayer, seed: number, rate: number): void {
  const w = layer.wind;
  if (!w) return;
  colouredNoise(samples, 'pink', seed);
  const [lo, hi] = w.band;
  let low = 0;
  let band = 0;
  let brown = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    const gust = wander(seed, t, w.gusts) * 0.7 + wander(seed + 1, t, w.gusts * 3) * 0.3;
    const centre = lo * (hi / lo) ** gust;
    const f = 2 * Math.sin((Math.PI * Math.min(centre, rate / 6)) / rate);
    brown = (brown + 0.02 * white(seed + 2, i)) / 1.02;
    const input = samples[i]! + brown * 2;
    // Chamberlin's state-variable filter, Q about 1.4.
    low += f * band;
    const high = input - low - 0.7 * band;
    band += f * high;
    samples[i] = band * (1 - w.depth + w.depth * gust);
  }
}

/** The glottal flow of one period at phase `p` (0–1): Rosenberg's pulse, open 40 %, closing 16 %. */
function glottal(p: number): number {
  if (p < 0.4) return 0.5 - 0.5 * Math.cos((Math.PI * p) / 0.4);
  if (p < 0.56) return Math.cos((Math.PI * (p - 0.4)) / 0.32);
  return 0;
}

/**
 * A voice (source and filter): glottal pulses at a pitch gliding from one to the other, each period
 * drawn a little off in pitch (jitter) and level (shimmer), every other one weaker in a growl
 * (`rough`), breath noise in the open phases; through the vowel's formants scaled by the tract's
 * length, radiated from the mouth (a first difference).
 */
export function voice(samples: Float32Array, layer: SfxLayer, seed: number, rate: number): void {
  const v = layer.voice;
  if (!v) return;
  const source = new Float32Array(samples.length);
  const [from, to] = v.pitch;
  let phase = 0;
  let period = 0;
  let periodPitch = 1;
  let periodLevel = 1;
  let last = 0;
  for (let i = 0; i < samples.length; i++) {
    const f = from * (to / from) ** (i / samples.length) * periodPitch;
    phase += f / rate;
    if (phase >= 1) {
      phase -= 1;
      period++;
      periodPitch = 1 + v.jitter * (hashUnit(seed, period, 1) * 2 - 1);
      periodLevel =
        (1 + v.shimmer * (hashUnit(seed, period, 2) * 2 - 1)) *
        (period % 2 ? 1 - (v.rough ?? 0) : 1);
    }
    const flow = glottal(phase) * periodLevel;
    const open = phase < 0.56 ? 1 : 0.2;
    const breath = v.breath * white(seed + 3, i) * open;
    // The flow's derivative is what radiates, then breath.
    source[i] = (flow - last) * 6 + breath;
    last = flow;
  }
  for (const [freq, bandwidth, gain] of v.formants) {
    const centre = freq / v.tract;
    if (centre >= rate * 0.45) continue;
    const band = source.slice();
    resonance(band, centre, bandwidth / v.tract, rate);
    for (let i = 0; i < samples.length; i++) samples[i] = samples[i]! + band[i]! * gain;
  }
}

/** A two-pole resonator at `freq` (Hz) of `bandwidth` (Hz), unit gain at its peak, in place. */
function resonance(samples: Float32Array, freq: number, bandwidth: number, rate: number): void {
  const r = Math.exp((-Math.PI * Math.max(bandwidth, 10)) / rate);
  const c = 2 * r * Math.cos((TAU * freq) / rate);
  const g = 1 - r;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const y = g * samples[i]! + c * y1 - r * r * y2;
    y2 = y1;
    y1 = y;
    samples[i] = y;
  }
}
