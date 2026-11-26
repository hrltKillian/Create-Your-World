import type { SkyDef } from '../../skySchema.ts';

const NIGHT = { zenith: '#080a22', horizon: '#1a1f44', light: '#b8bcff', stars: 1 };
const DAY = { zenith: '#3f7fc0', horizon: '#a6d2dc', light: '#fff8ee', stars: 0 };

/**
 * Veyra's sky (plan v4 « M39 », decision 29): Earth-like blues a little off towards teal by day,
 * a violet night, magenta-and-amber dawns and dusks; a warm sun; two moons, the pale Ilen that
 * lights the night and the small rust Corva; the ringed giant Aster in the north-east at midnight; nebulae
 * of teal and violet; auroras green to violet over the cold lands (BiomeDef.aurora).
 */
export const sky: SkyDef = {
  keys: [
    { hour: 0, ...NIGHT },
    { hour: 4.5, ...NIGHT },
    { hour: 5.4, zenith: '#3b4282', horizon: '#e48a7a', light: '#ffc2ae', stars: 0.2 },
    { hour: 6.5, ...DAY },
    { hour: 17.5, ...DAY },
    { hour: 19.1, zenith: '#46377e', horizon: '#ea7357', light: '#ffae92', stars: 0.15 },
    { hour: 20.5, ...NIGHT },
  ],
  sun: { color: '#fff0cf', size: 2.6 },
  moons: [
    { color: '#dfe3f2', size: 2.4, period: 8, tilt: -0.35 },
    { color: '#c98a6a', size: 1.2, period: 5, tilt: 0.1 },
  ],
  giant: {
    color: '#c7b39a',
    bands: '#8a6f62',
    ring: '#e3d8c6',
    size: 5,
    azimuth: 40,
    elevation: 32,
  },
  nebula: ['#3a2a6e', '#1f5a66'],
  aurora: ['#5cf2a8', '#9a6bff'],
};
