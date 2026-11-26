import { describe, expect, it } from 'vitest';
import { runTitleSky } from '../../../src/app/titleSky.ts';
import { registry } from '../../helpers/registry.ts';
import { createTestWorldView } from '../../helpers/worldView.ts';

describe('the title sky (plan v4 « M43 »)', () => {
  it("turns Veyra's night sky behind the main menu, auroras rising in", () => {
    const { view } = createTestWorldView();
    let frame: ((dt: number) => void) | null = null;
    runTitleSky(view, registry, (f) => {
      frame = f;
    });
    expect(frame).not.toBeNull();
    for (let i = 0; i < 300; i++) frame!(1 / 30);
    // Night: little daylight; looking up from high above the land.
    expect(view.materials.uniforms.uDaylight.value).toBeLessThan(0.2);
    expect(view.camera.position.y).toBeGreaterThan(500);
    expect(view.camera.rotation.x).toBeGreaterThan(0.3);
  });
});
