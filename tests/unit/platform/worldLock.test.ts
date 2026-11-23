import { describe, expect, it } from 'vitest';
import { lockWorld } from '../../../src/platform/worldLock.ts';

// Node implements the Web Locks API: two requests in one process contend like two tabs.
describe('world lock', () => {
  it('lets one tab hold a world until it releases it', async () => {
    const first = await lockWorld('lock-a');
    expect(first).not.toBeNull();
    expect(await lockWorld('lock-a')).toBeNull();
    const other = await lockWorld('lock-b');
    expect(other).not.toBeNull();
    await first!.release();
    const again = await lockWorld('lock-a');
    expect(again).not.toBeNull();
    await again!.release();
    await other!.release();
  });

  it('lets every tab in without Web Locks', async () => {
    const a = await lockWorld('lock-c', null);
    const b = await lockWorld('lock-c', null);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });
});
