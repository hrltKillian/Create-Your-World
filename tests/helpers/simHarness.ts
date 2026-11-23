import { type InputCommand, NEUTRAL_INPUT } from '../../src/sim/commands.ts';
import {
  createInlineSim,
  type InlineSim,
  type InlineSimOptions,
} from '../../src/sim/testing/inlineSim.ts';
import { registry } from './registry.ts';

/**
 * An inline simulation on the shared test registry (see createInlineSim), with tick helpers that
 * append to `events`. Player 1 joins with `sim.addPlayer(1, viewRadius)`.
 */
export function createTestSim(options: Omit<InlineSimOptions, 'registry'>) {
  return withTicks(createInlineSim({ registry, ...options }));
}

/** Tick helpers over an inline simulation (a new one, or one restored from a save). */
export function withTicks(inline: InlineSim) {
  const { host, events } = inline;
  return {
    ...inline,
    /** Advances `n` ticks without sending anything. */
    step: (n = 1): void => {
      for (let i = 0; i < n; i++) host.advance(1, events);
    },
    /** Sends `input` (over the neutral input) before each of `n` ticks. */
    tick: (n: number, input: Partial<InputCommand> = {}): void => {
      for (let i = 0; i < n; i++) {
        host.send({ ...NEUTRAL_INPUT, ...input });
        host.advance(1, events);
      }
    },
  };
}
