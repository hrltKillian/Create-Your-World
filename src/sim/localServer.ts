import { createHost, type SimHost } from './host.ts';
import { type SimOptions, Simulation } from './Simulation.ts';

export interface LocalServerOptions extends SimOptions {
  /** Connection id of the local player. */
  readonly playerId: number;
  /** Render distance of the local player (columns). */
  readonly viewRadius: number;
  /** Route every command and event through JSON (proves the protocol is network-safe). */
  readonly serialize?: boolean;
}

/**
 * Builds the authoritative side of a local game: the simulation, its player and the host the client
 * talks to. The Simulation stays private: the client only reads `host.view` and sends commands, as
 * it would with a remote server.
 */
export function createLocalServer(options: LocalServerOptions): SimHost {
  const sim = new Simulation(options);
  sim.addPlayer(options.playerId, options.viewRadius);
  return createHost(sim, options.playerId, options.serialize);
}
