import { describe, expect, it } from 'vitest';
import { NEUTRAL_INPUT } from '../../../src/sim/commands.ts';
import type { SimEvent } from '../../../src/sim/events.ts';
import { SerializingSimHost } from '../../../src/sim/host.ts';
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

  it('routes commands and events through JSON when asked, with the same results', () => {
    const run = (serialize: boolean) => {
      const host = createLocalServer({
        seed: 'server',
        registry,
        source: new InlineColumnSource(registry),
        maxInFlight: 8,
        allowDebug: true,
        playerId: 1,
        viewRadius: 2,
        serialize,
      });
      expect(host instanceof SerializingSimHost).toBe(serialize);
      const events: SimEvent[] = [];
      host.advance(60, events);
      const spawn = host.view.spawn;
      host.send({ type: 'debug.teleport', x: spawn.x + 40, y: 'surface', z: spawn.z });
      for (let i = 0; i < 90; i++) {
        host.send({ ...NEUTRAL_INPUT, forward: 1, yaw: 0.3, jump: i % 20 === 0 });
        host.advance(1, events);
      }
      host.send({ type: 'client.view', x: spawn.x, z: spawn.z, radius: Number.NaN });
      host.pumpWorld({ columns: 4 }, events);
      return { hash: host.view.hash(), events };
    };
    const json = run(true);
    const direct = run(false);
    expect(json.hash).toBe(direct.hash);
    expect(json.events).toEqual(direct.events);
    expect(json.events.some((e) => e.type === 'rejected')).toBe(true);
    expect(json.events.length).toBeGreaterThan(10);
  });
});
