import { i18nMissing } from '../../i18n/i18n.ts';
import type { App } from '../App.ts';

export interface SelftestCase {
  readonly name: string;
  run(app: App): Promise<void> | void;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** In-browser acceptance checks, one suite per milestone. Earlier suites must stay green. */
export const SUITES: Readonly<Record<string, readonly SelftestCase[]>> = {
  m0: [
    { name: 'app is ready', run: (app) => app.ready() },
    {
      name: 'title is shown',
      run: (app) => {
        assert(app.state === 'title', `state is ${app.state}`);
        assert(document.querySelector('#screen-title .title')?.textContent, 'title text missing');
      },
    },
    {
      name: 'workers answer ping',
      run: async (app) => {
        assert(app.workers, 'no worker pool');
        assert((await app.workers.ping()) === 'pong', 'ping failed');
      },
    },
    {
      name: 'renderer draws the test cube',
      run: () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    },
    {
      name: 'no errors and no missing strings',
      run: (app) => {
        assert(app.errors.length === 0, `errors: ${app.errors.join(' | ')}`);
        assert(i18nMissing().length === 0, `missing strings: ${i18nMissing().join(', ')}`);
      },
    },
  ],
};
