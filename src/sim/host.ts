import type { Registry } from '../content/registry.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import type { Command } from './commands.ts';
import type { SimEvent } from './events.ts';
import type { Simulation } from './Simulation.ts';

/** Read-only view of the simulation for rendering, UI and audio. */
export interface SimView {
  readonly world: VoxelWorld;
  readonly registry: Registry;
  readonly seed: string;
  tick(): number;
  columnState(cx: number, cz: number): number;
}

/** Client ⇄ simulation contract. A future RemoteSimHost implements it over the network. */
export interface SimHost {
  readonly view: SimView;
  send(command: Command): void;
  /** Runs `ticks` steps and appends their events to `out` (no allocation per tick). */
  advance(ticks: number, out: SimEvent[]): void;
  /** Integrates more generated columns outside play (loading screen, tests). */
  pumpWorld(budget: { readonly columns: number }, out: SimEvent[]): void;
  readonly canPause: boolean;
}

/** v1 host: the simulation runs in this page; the view exposes live objects without copies. */
export class LocalSimHost implements SimHost {
  readonly view: SimView;
  readonly canPause = true;
  private readonly sim: Simulation;
  private readonly playerId: number;
  private seq = 0;

  constructor(sim: Simulation, playerId = 1) {
    this.sim = sim;
    this.playerId = playerId;
    this.view = {
      world: sim.world,
      registry: sim.registry,
      seed: sim.seed,
      tick: () => sim.tick,
      columnState: (cx, cz) => sim.columnState(cx, cz),
    };
  }

  send(command: Command): void {
    this.sim.enqueue({ playerId: this.playerId, seq: this.seq++, command });
  }

  advance(ticks: number, out: SimEvent[]): void {
    for (let i = 0; i < ticks; i++) this.sim.step(out);
  }

  pumpWorld(budget: { readonly columns: number }, out: SimEvent[]): void {
    this.sim.pump(budget.columns, out);
  }
}
