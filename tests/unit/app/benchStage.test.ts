import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../../src/app/App.ts';
import { clock } from '../../../src/app/automation.ts';
import { staged, teleportAndWait } from '../../../src/app/bench/stage.ts';
import { playerTestSim } from '../../helpers/simHarness.ts';

/** An app over a test simulation in real time, where no tick runs on its own. */
function realTimeApp() {
  const s = playerTestSim({ seed: 'stage' });
  const session = {
    host: s.host,
    player: s.player,
    // As GameSession's: commands sent apply at once; a tick only for a hidden page.
    pumpOnce: (tick: boolean) => {
      if (tick) s.step(1);
      else s.host.pumpWorld({ columns: 0 }, s.events);
    },
  };
  return { s, app: { session, params: { fixedStep: false } } as unknown as App };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the benchmarks’ stage', () => {
  it('teleportAndWait lands on a hidden page, where only the pump ticks', async () => {
    vi.stubGlobal('document', { hidden: true });
    const { s, app } = realTimeApp();
    await teleportAndWait(app, 6.5, 'surface', -9.5);
    expect([s.player.body.x, s.player.body.z]).toEqual([6.5, -9.5]);
  });

  it('staged runs at a frozen hour with the player immune, then puts both back, even on a failure', async () => {
    const { s, app } = realTimeApp();
    const before = clock(app)!;
    const stage = () => ({
      hour: clock(app)!.hour,
      frozen: clock(app)!.frozen,
      god: s.player.survival.god,
    });
    const back = () => {
      expect(clock(app)!.hour).toBeCloseTo(before.hour, 6);
      expect(clock(app)!.frozen).toBe(before.frozen);
      expect(s.player.survival.god).toBe(false);
    };
    expect(await staged(app, 23, async () => stage())).toEqual({
      hour: 23,
      frozen: true,
      god: true,
    });
    back();
    await expect(
      staged(app, 12, async () => {
        throw new Error('the run failed');
      }),
    ).rejects.toThrow('the run failed');
    back();
  });
});
