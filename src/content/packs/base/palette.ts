import { type BlockKey, MASK_INDEX, type TexKey, type TextureDef } from '../../schema.ts';

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
  // Blocks (plan v5 « M50 »): ramps from each block's colours in the world.
  dirt: ['#1e0e0e', '#411f19', '#5f3523', '#7c5435', '#997353', '#b3947a'],
  grass: ['#022117', '#2f7c4a', '#5e9741', '#9cb13e', '#c2d064', '#e9ef9c'],
  sand: ['#27150f', '#aa8268', '#c7a174', '#dfc78d', '#fee9b9', '#fff4dc'],
  gravel: ['#1d1a19', '#4c4542', '#675e59', '#847d75', '#a39c94', '#c2bdb6'],
  darkstone: ['#06070a', '#1a1c23', '#2f333c', '#4a4e58', '#696a75', '#8b8890'],
  snow: ['#191b1d', '#b0b5ba', '#c7ced4', '#e2eaf1', '#edf7fb', '#eef7f9'],
  permafrost: ['#191b1d', '#444a4f', '#5c646a', '#798289', '#97a2a7', '#b9c3c4'],
  ochre: ['#2e1012', '#924c40', '#b76541', '#d7884a', '#f5ab6d', '#ffd7b4'],
  sandstone: ['#2e0f13', '#7e3933', '#a35034', '#c4723b', '#e2945d', '#f8bc8d'],
  peat: ['#0a0404', '#190a06', '#311e15', '#4b3a2a', '#675645', '#827466'],
  silt: ['#131d1a', '#2a3b2f', '#455440', '#686f57', '#888d75', '#a9ac98'],
  barkLantern: ['#09070e', '#21192c', '#392f47', '#564964', '#78657d', '#998494'],
  ringsLantern: ['#20181a', '#7a6868', '#99827f', '#baa29b', '#dac4ba', '#f8e7de'],
  leafLantern: ['#012117', '#1a8349', '#569e37', '#9cb723', '#c4d652', '#ebf591'],
  barkVeil: ['#110104', '#33040a', '#531711', '#73351c', '#905537', '#a7785d'],
  needleVeil: ['#081e23', '#064248', '#135e5f', '#367d76', '#5f9c8c', '#8eb9a6'],
  barkFrost: ['#04060a', '#141923', '#28303d', '#414b5a', '#5a6975', '#78888e'],
  needleFrost: ['#061e27', '#125463', '#16717e', '#369297', '#61b3ac', '#96d1c2'],
  barkTwist: ['#03120b', '#0f2c14', '#2f431c', '#585c2b', '#77794a', '#979771'],
  needleTwist: ['#0c1e1e', '#174038', '#2d5b49', '#52785c', '#769677', '#9db397'],
  barkWillow: ['#0d0e12', '#22252e', '#383c48', '#525865', '#747482', '#96929d'],
  leafWillow: ['#151c1d', '#728483', '#8ca19d', '#acc2ba', '#d0e3d9', '#ecf9ef'],
  barkPod: ['#000a07', '#012314', '#1d3b1f', '#43552e', '#63714a', '#858e6d'],
  leafPod: ['#012117', '#165b33', '#43752e', '#7b8f30', '#9fad54', '#c4cb86'],
  podFruit: ['#2f1007', '#955324', '#b4700c', '#c89921', '#e8ba54', '#fedf9e'],
  glass: ['#121c22', '#8ba6b2', '#9cc1cc', '#b4dee6', '#d2fbfc', '#ddfdf8'],
  planks: ['#281414', '#542a1f', '#734126', '#8f6136', '#ad8156', '#c7a481'],
  brick: ['#2b1118', '#5a2129', '#7f3531', '#a1543d', '#bf7558', '#d69b7f'],
  firebrick: ['#251613', '#ad8a77', '#c6a281', '#dbc296', '#f7deb3', '#fff4e1'],
  colonyBrick: ['#211816', '#675449', '#826f5c', '#9d9077', '#bdb098', '#dcd1be'],
  hull: ['#181b1f', '#373e47', '#4d5763', '#697581', '#85959e', '#a6b6ba'],
  stem: ['#201916', '#a7958a', '#bfae9c', '#d6ccb4', '#f2e8d1', '#fcf4e2'],
  cap: ['#0b0615', '#241639', '#3e2a58', '#5b4477', '#825f8d', '#a47f9e'],
  magma: ['#340616', '#6c021f', '#9a020f', '#bb3d02', '#df601d', '#f18f59'],
  bedroll: ['#2c1017', '#622227', '#86372b', '#a85634', '#c77851', '#dd9f7b'],
  tallGrass: ['#0f1e19', '#5e7b66', '#7e9775', '#a8b58a', '#ccd5aa', '#f0f5d3'],
  lichen: ['#161b1f', '#6f7e87', '#869ba5', '#a4bdc4', '#c5dfe2', '#e5faf9'],
  amber: ['#2f1006', '#9c5a28', '#ba7812', '#cda128', '#edc25a', '#fee8b7'],
  fern: ['#031519', '#003033', '#044b49', '#2b695f', '#528776', '#7fa491'],
  reed: ['#022117', '#1e5934', '#477334', '#7b8d39', '#9fab5b', '#c3ca8b'],
  shrub: ['#271512', '#563222', '#734b2b', '#8d6c3e', '#ab8c5f', '#c6ad8a'],
  thorn: ['#190f0e', '#38241c', '#523c2b', '#6d5a42', '#8a7860', '#a69884'],
  bloom: ['#041f23', '#357678', '#43958f', '#66b7a4', '#92d7bb', '#c5f5d8'],
  lampLight: ['#2f1008', '#d99268', '#f4ac5f', '#fed27e', '#fff4df', '#fff4e0'],
  kilnClay: ['#271418', '#552a2d', '#764039', '#975e4a', '#b57e66', '#cea28b'],
  darkMetal: ['#08090b', '#1b1f24', '#30363d', '#4a5259', '#667075', '#858f91'],
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

/** A block's drawn icon (plan v5 « M50 »): the block, and the art its item shows in slots. */
export interface BlockArt {
  readonly block: BlockKey;
  readonly texture: TextureDef;
}

/** A block's icon drawn by hand (see `art`); its key `tex:icon_block_<name>`. */
export function blockArt(block: BlockKey, mats: readonly Mat[], grid: string): BlockArt {
  return {
    block,
    texture: art(`tex:icon_block_${block.slice(block.indexOf(':') + 1)}`, mats, grid),
  };
}
