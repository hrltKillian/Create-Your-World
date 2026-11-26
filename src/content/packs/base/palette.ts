import { MASK_INDEX, type TexKey, type TextureDef } from '../../schema.ts';

/*
 * Veyra's palette (plan v5 « M49 »): every item icon is drawn from these ramps only, six tones a
 * material (outline, deep shadow, shadow, base, light, highlight), their hues shifted towards
 * violet in the shadows and warm yellow in the light so that the materials sit together. Large,
 * but finite: no colour of an icon's own (tests/unit/content/palette.test.ts).
 */
export const RAMPS = {
  wood: ['#180608', '#411813', '#65321e', '#885532', '#ab7a55', '#c9a383'],
  flint: ['#07090d', '#20242d', '#3b414d', '#5c6372', '#7f8996', '#a6b0ba'],
  stone: ['#1d1a18', '#403934', '#5d574e', '#7f7a6f', '#a39e94', '#c8c4bc'],
  copper: ['#300d17', '#792830', '#a53f2f', '#cc6531', '#ee8d54', '#ffbd93'],
  patina: ['#031f21', '#236562', '#318379', '#55a38f', '#7ec3a8', '#afe1c6'],
  bronze: ['#2e100f', '#88472d', '#a96523', '#c08f2f', '#e1b25d', '#fdd896'],
  iron: ['#171b20', '#3b434e', '#576371', '#7a8897', '#9eb0bc', '#c7d9e0'],
  leather: ['#180508', '#401412', '#632c1c', '#854d2c', '#a7704d', '#c29778'],
  hide: ['#271419', '#6a3b42', '#8e5353', '#b37368', '#d49686', '#efbdac'],
  fur: ['#231716', '#553c33', '#755845', '#947b5f', '#b69f83', '#d7c4ad'],
  fiber: ['#01201d', '#015942', '#287840', '#6d953f', '#97b45f', '#c3d38e'],
  straw: ['#2b130e', '#976646', '#b08346', '#bfaa5d', '#dec980', '#fbe9b0'],
  cord: ['#281513', '#734b3a', '#926744', '#ad8c5a', '#ceaf7e', '#ecd3ac'],
  raw: ['#310a1c', '#6a0732', '#96183c', '#c03c47', '#e3645d', '#f99481'],
  fat: ['#241618', '#c29d9b', '#dbafa7', '#f2c5b6', '#fee0d4', '#fef2ed'],
  cooked: ['#1f060d', '#4b1118', '#72281d', '#964b27', '#b87048', '#d29a75'],
  fish: ['#0b1d27', '#2e5c71', '#3a7b91', '#549fb0', '#78c3c8', '#abe4df'],
  violet: ['#1c0e31', '#401969', '#633095', '#8951bf', '#bd72d5', '#e99de2'],
  teal: ['#001f23', '#027d7e', '#1b9a93', '#21bea8', '#59debb', '#a0f9d3'],
  fruit: ['#31091b', '#902e42', '#bd423f', '#e46738', '#fc9666', '#fecaad'],
  paper: ['#221815', '#b0988a', '#c5ae96', '#d8c9aa', '#f0e1c3', '#fff4de'],
  cloth: ['#1e1917', '#aca29a', '#c1b8ac', '#d6d1c2', '#eee9db', '#f9f5ea'],
  water: ['#051c30', '#0a4f7b', '#156d9e', '#1f91c5', '#3db8dc', '#7cdbea'],
  foul: ['#072017', '#1d4526', '#425f2b', '#737b39', '#969a5c', '#babb89'],
  ice: ['#0b1d27', '#6d9cb3', '#76b5ce', '#89d1e7', '#a3ecf9', '#d9feff'],
  clay: ['#161b20', '#4f5b64', '#667682', '#8295a1', '#a1b6bf', '#c5d7dc'],
  terracotta: ['#2d1017', '#6a272e', '#913c34', '#b65e3e', '#d7825c', '#efac88'],
  coal: ['#050608', '#07080e', '#171921', '#2b2d36', '#42434d', '#5b5a62'],
  shell: ['#291412', '#6e402e', '#8f5d36', '#ac844b', '#cfa871', '#edcfa3'],
  crystal: ['#1b162f', '#645693', '#826ebc', '#a48ee3', '#d8abf9', '#fcd5fe'],
  resin: ['#330915', '#a8463d', '#cf6116', '#de9225', '#fcb655', '#fee2be'],
  red: ['#340518', '#71032b', '#9d1432', '#cc3336', '#ef604e', '#fb9981'],
  tech: ['#111d20', '#264347', '#3c6163', '#5b8382', '#7fa6a1', '#aac8c2'],
  toxic: ['#02201c', '#017d58', '#1ba036', '#8bb612', '#b7d532', '#e3f27d'],
  sinew: ['#281418', '#7f4f52', '#a36662', '#c68675', '#e6a892', '#ffcdb9'],
  bone: ['#201916', '#a19185', '#b8a895', '#cec3ac', '#e8ddc7', '#fdf4e2'],
  glow: ['#011f25', '#189cab', '#15b8c1', '#15d8d8', '#5ff5e9', '#d8fff6'],
  ember: ['#33061c', '#a7364a', '#d54834', '#f2761a', '#fda86c', '#ffd8b9'],
  moss: ['#011815', '#053427', '#01542e', '#427138', '#6a9054', '#95ae7b'],
  dawn: ['#241229', '#8a5482', '#b76693', '#e4829e', '#fcadaf', '#fedfd8'],
  shine: ['#24222b', '#a9adbb', '#c8cbd6', '#e1e3ea', '#f3f4f7', '#ffffff'],
} as const satisfies Record<string, readonly [string, string, string, string, string, string]>;

export type Mat = keyof typeof RAMPS;

/** The outline of every icon: near black, touched with violet. */
export const INK = '#17121d';

/** Every colour of the palette. */
export const PALETTE: ReadonlySet<string> = new Set([INK, ...Object.values(RAMPS).flat()]);

/**
 * The letters of an icon's grid: `#` the ink outline, `W` a white glint and `V` its grey, and five
 * letters a material (its deep shadow, shadow, base, light and highlight), for the materials in
 * the order given: `abcde`, `fghij`, `klmno`, `pqrst`, `uvwxy`; `.` is transparent.
 */
const LETTERS = ['abcde', 'fghij', 'klmno', 'pqrst', 'uvwxy'] as const;

/**
 * An item icon drawn pixel by pixel (plan v5 « M49 »): 32 rows of 32 letters from the top, in
 * the materials named (see LETTERS). Its palette is the colours it uses, from the palette's ramps.
 */
export function art(key: TexKey, mats: readonly Mat[], grid: string): TextureDef {
  const colourOf = (ch: string): string => {
    if (ch === '#') return INK;
    if (ch === 'W') return RAMPS.shine[5];
    if (ch === 'V') return RAMPS.shine[3];
    const m = LETTERS.findIndex((group) => group.includes(ch));
    const mat = mats[m];
    if (!mat) throw new Error(`${key}: "${ch}" names no material`);
    return RAMPS[mat][LETTERS[m]!.indexOf(ch) + 1]!;
  };
  const palette: string[] = [];
  const mask = grid
    .trim()
    .split('\n')
    .map((row) =>
      [...row.trim()]
        .map((ch) => {
          if (ch === '.') return '.';
          const colour = colourOf(ch);
          if (!palette.includes(colour)) palette.push(colour);
          return MASK_INDEX[palette.indexOf(colour)]!;
        })
        .join(''),
    );
  return { key, pattern: 'icon', palette, seed: 0, alpha: 'coverage', mask };
}
