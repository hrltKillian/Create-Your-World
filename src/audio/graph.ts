/** The Web Audio graph of the engine (browser only): buses, the underwater filter and the voices. */

/** Cutoffs of the underwater low-pass (Hz): open in the air, muffled under water. */
export const WATER_FILTER = {
  openHz: 20_000,
  underwaterHz: 700,
  /** Time constant of the glide between them (s). */
  glide: 0.08,
} as const;

/** What voice stealing needs to know about a voice. */
export interface VoiceSlot {
  /** Clock time (ms) the voice started and the time its sound ends. */
  startedAt: number;
  endsAt: number;
  /** Gain × distance attenuation when it started. */
  audibility: number;
}

export interface Voice extends VoiceSlot {
  source: AudioBufferSourceNode | null;
  readonly gain: GainNode;
  readonly panner: PannerNode;
}

/** One of the two rooms the effects reverberate in, crossfaded when the place changes. */
export interface Room {
  readonly convolver: ConvolverNode;
  readonly level: GainNode;
}

export interface Graph {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  /** The effects' send into the rooms (plan v4 « M44 »), and the two rooms. */
  readonly reverb: { readonly send: GainNode; readonly rooms: readonly [Room, Room] };
  /** Effects and ambience pass through it (passe-bas sous l'eau); the interface does not. */
  readonly water: BiquadFilterNode;
  readonly sfx: GainNode;
  readonly ambience: GainNode;
  readonly ui: GainNode;
  readonly voices: Voice[];
}

/** Distances of the voices' linear panners (m). */
export interface PannerRange {
  readonly near: number;
  readonly far: number;
}

/**
 * The context, its buses (sfx and ambience → underwater low-pass → master, ui → master, master →
 * compressor), the effects' reverb send into two rooms (into the low-pass) and `voices` voices,
 * each a gain and an HRTF panner.
 */
export function createGraph(voices: number, range: PannerRange): Graph {
  const ctx = new AudioContext();
  const compressor = ctx.createDynamicsCompressor();
  compressor.connect(ctx.destination);
  const master = ctx.createGain();
  master.connect(compressor);
  const water = ctx.createBiquadFilter();
  water.type = 'lowpass';
  water.frequency.value = WATER_FILTER.openHz;
  water.connect(master);
  const sfx = ctx.createGain();
  const ambience = ctx.createGain();
  const ui = ctx.createGain();
  sfx.connect(water);
  ambience.connect(water);
  ui.connect(master);
  // The effects reverberate in the room of the place (AudioEngine.setReverb), into the low-pass.
  const send = ctx.createGain();
  send.gain.value = 0;
  sfx.connect(send);
  const room = (): Room => {
    const convolver = ctx.createConvolver();
    convolver.normalize = false;
    const level = ctx.createGain();
    level.gain.value = 0;
    send.connect(convolver).connect(level).connect(water);
    return { convolver, level };
  };
  const rooms: [Room, Room] = [room(), room()];
  const list: Voice[] = [];
  for (let i = 0; i < voices; i++) {
    const panner = new PannerNode(ctx, {
      // Heads and ears (plan v4 « M44 »): above, below and behind read as such.
      panningModel: 'HRTF',
      distanceModel: 'linear',
      refDistance: range.near,
      maxDistance: range.far,
      rolloffFactor: 1,
    });
    list.push({
      source: null,
      gain: ctx.createGain(),
      panner,
      startedAt: 0,
      endsAt: 0,
      audibility: 0,
    });
  }
  return { ctx, master, reverb: { send, rooms }, water, sfx, ambience, ui, voices: list };
}
