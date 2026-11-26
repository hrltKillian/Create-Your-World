import { assert, noErrorsCase, PLAY_SCENES, playerSession, type SelftestCase } from './support.ts';

/*
 * M36 textures (plan v4 « M36 »), in any world with a player: the pack's textures are in two
 * arrays of the pack's texture size, one layer each, colours in sRGB and materials (normal,
 * roughness, cavity) as linear data, filtered with anisotropy where the GPU has it.
 */

const arraysCase: SelftestCase = {
  name: 'the pack textures and their materials are two arrays of the pack size',
  scenes: PLAY_SCENES,
  run: async (app) => {
    await playerSession(app);
    const pack = app.registry!.pack;
    const uniforms = app.view!.materials.uniforms;
    const colours = uniforms.uTextures.value;
    const materials = uniforms.uMaterials.value;
    const size = pack.manifest.textureSize;
    for (const [name, array, space] of [
      // three's names of the colour spaces: sRGB, and none (linear data).
      ['colours', colours, 'srgb'],
      ['materials', materials, ''],
    ] as const) {
      const { width, height, depth } = array.image;
      assert(width === size && height === size, `${name}: ${width}×${height}, not ${size}`);
      assert(
        depth === pack.textures.length,
        `${name}: ${depth} layers for ${pack.textures.length}`,
      );
      assert(array.colorSpace === space, `${name} in ${array.colorSpace}`);
    }
    const most = app.renderer!.webgl.capabilities.getMaxAnisotropy();
    assert(colours.anisotropy === Math.min(4, most), `anisotropy ${colours.anisotropy}`);
  },
};

export const M36_SUITE: readonly SelftestCase[] = [
  arraysCase,
  noErrorsCase('no errors after the m36 checks'),
];
