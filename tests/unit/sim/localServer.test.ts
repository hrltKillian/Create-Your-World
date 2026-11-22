import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../../src/sim/events.ts';
import { InlineColumnSource } from '../../../src/sim/InlineColumnSource.ts';
import { createLocalServer } from '../../../src/sim/localServer.ts';
import { registry } from '../../helpers/registry.ts';

describe('createLocalServer', () => {
  it('gives the client a host whose view exposes the player, spawn, generation and hash', () => {
    const host = createLocalServer({
      seed: 'server',
      worldType: 'flat',
      registry,
      source: new InlineColumnSource(registry),
      maxInFlight: 8,
      playerId: 3,
      viewRadius: 2,
    });
    const view = host.view;
    const player = view.player()!;
    expect(player.playerId).toBe(3);
    expect(view.spawn.y).toBe(65);
    expect(view.gen.worldType).toBe('flat');
    const events: SimEvent[] = [];
    const before = view.hash();
    host.advance(30, events);
    expect(view.tick()).toBe(30);
    expect(view.hash()).not.toBe(before);
    expect(view.world.columns.size).toBeGreaterThan(9);
  });

  it('routes commands through JSON when asked, with the same result', () => {
    const run = (serialize: boolean) => {
      const host = createLocalServer({
        seed: 'server',
        registry,
        source: new InlineColumnSource(registry),
        maxInFlight: 8,
        playerId: 1,
        viewRadius: 2,
        serialize,
      });
      host.advance(60, []);
      return host.view.hash();
    };
    expect(run(true)).toBe(run(false));
  });
});
