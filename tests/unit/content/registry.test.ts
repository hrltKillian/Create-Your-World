import { describe, expect, it } from 'vitest';
import { rotateBoxY } from '../../../src/content/blockStates.ts';
import { basePack } from '../../../src/content/packs/base/index.ts';
import {
  buildRegistry,
  FACE_EAST,
  FACE_NORTH,
  FACE_SOUTH,
  FACE_UP,
  FACEFLAG_EMISSIVE,
  FACEFLAG_UV_ROTATE,
  FLAG_OPAQUE,
  FLAG_SOLID,
} from '../../../src/content/registry.ts';
import { registry } from '../../helpers/registry.ts';

const t = registry.tables;
const layer = (key: string) => registry.textureKeys.indexOf(key as `tex:${string}`);

describe('registry', () => {
  it('flattens states, with air as state 0', () => {
    expect(registry.air).toBe(0);
    expect(registry.states[0]!.key).toBe('block:air');
    expect(registry.defaultState('block:stone')).toBeGreaterThan(0);
    const gates = registry.states.filter((s) => s.key.startsWith('block:gate['));
    expect(gates).toHaveLength(16);
    expect(registry.states.filter((s) => s.key.startsWith('block:broadleaf_log['))).toHaveLength(3);
    expect(t.stateCount).toBe(registry.states.length);
  });

  it('builds readable state keys and changes one property at a time', () => {
    const gate = registry.defaultState('block:gate');
    expect(registry.states[gate]!.key).toBe('block:gate[facing4=n,open=0,half=lower]');
    const open = registry.withState(gate, 'open', '1');
    expect(registry.states[open]!.key).toBe('block:gate[facing4=n,open=1,half=lower]');
    expect(registry.withState(open, 'facing4', 'e')).toBe(
      registry.stateId('block:gate[facing4=e,open=1,half=lower]'),
    );
    expect(registry.stateIdOrUnknown('block:nope')).toBe(registry.unknownBlock);
  });

  it('keeps light blocking separate from face culling (gate)', () => {
    const closed = registry.defaultState('block:gate');
    const open = registry.withState(closed, 'open', '1');
    expect(t.flags[closed]! & FLAG_OPAQUE).toBe(0);
    expect(t.lightFilter[closed]).toBe(15);
    expect(t.flags[closed]! & FLAG_SOLID).toBe(FLAG_SOLID);
    expect(t.lightFilter[open]).toBe(0);
    expect(t.flags[open]! & FLAG_SOLID).toBe(0);
    expect(t.boxShapes[t.boxShape[closed]!]).not.toEqual(t.boxShapes[t.boxShape[open]!]);
  });

  it('applies state overrides and facing to textures (kiln)', () => {
    const kiln = registry.defaultState('block:kiln');
    const lit = registry.withState(kiln, 'lit', '1');
    expect(t.emit[kiln]).toBe(0);
    expect(t.emit[lit]).toBe(12);
    expect(t.faceLayer[kiln * 6 + FACE_NORTH]).toBe(layer('tex:kiln_front'));
    expect(t.faceLayer[kiln * 6 + FACE_SOUTH]).toBe(layer('tex:kiln_side'));
    expect(t.faceLayer[lit * 6 + FACE_NORTH]).toBe(layer('tex:kiln_front_lit'));
    expect(t.faceFlags[lit * 6 + FACE_NORTH]! & FACEFLAG_EMISSIVE).toBe(FACEFLAG_EMISSIVE);
    const east = registry.withState(kiln, 'facing4', 'e');
    expect(t.faceLayer[east * 6 + FACE_EAST]).toBe(layer('tex:kiln_front'));
    expect(t.faceLayer[east * 6 + FACE_UP]).toBe(layer('tex:kiln_top'));
  });

  it('orients log textures by axis', () => {
    const y = registry.defaultState('block:broadleaf_log');
    const x = registry.withState(y, 'axis', 'x');
    expect(t.faceLayer[y * 6 + FACE_UP]).toBe(layer('tex:log_rings'));
    expect(t.faceLayer[x * 6 + FACE_EAST]).toBe(layer('tex:log_rings'));
    expect(t.faceLayer[x * 6 + FACE_UP]).toBe(layer('tex:log_bark'));
    expect(t.faceFlags[x * 6 + FACE_UP]! & FACEFLAG_UV_ROTATE).toBe(FACEFLAG_UV_ROTATE);
    expect(t.faceFlags[y * 6 + FACE_SOUTH]! & FACEFLAG_UV_ROTATE).toBe(0);
  });

  it('rotates boxes clockwise seen from above', () => {
    expect(rotateBoxY([0, 0, 0, 16, 16, 3], 1)).toEqual([13, 0, 0, 16, 16, 16]);
    expect(rotateBoxY([0, 0, 0, 16, 16, 3], 4)).toEqual([0, 0, 0, 16, 16, 3]);
  });

  it('survives a JSON round trip of the pack', () => {
    const copy = buildRegistry(JSON.parse(JSON.stringify(basePack)));
    expect(copy.states.map((s) => s.key)).toEqual(registry.states.map((s) => s.key));
    expect(Array.from(copy.tables.faceLayer)).toEqual(Array.from(t.faceLayer));
    expect(Array.from(copy.tables.flags)).toEqual(Array.from(t.flags));
  });
});
