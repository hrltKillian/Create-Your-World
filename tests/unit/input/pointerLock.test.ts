import { afterEach, describe, expect, it } from 'vitest';
import { PointerLock } from '../../../src/input/pointerLock.ts';
import { FakeTarget } from '../../helpers/fakeTarget.ts';

/*
 * Chrome's order on a refused request: the promise rejects (a microtask), then `pointerlockerror`
 * fires (a task). Where raw input is unsupported the first, unadjusted, request is refused and the
 * plain retry takes the lock.
 */

const global = globalThis as { document?: unknown };

/** A page whose element refuses the unadjusted mode, and takes the lock in plain mode if `plain`. */
function page(plain: boolean) {
  const doc = Object.assign(new FakeTarget(), { pointerLockElement: null as unknown });
  global.document = doc;
  const element = {
    requestPointerLock(options?: { unadjustedMovement?: boolean }) {
      const refused = options?.unadjustedMovement === true || !plain;
      return new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          if (refused) {
            reject(new DOMException('refused', 'NotSupportedError'));
            setTimeout(() => doc.dispatch('pointerlockerror', {}));
          } else {
            doc.pointerLockElement = element;
            doc.dispatch('pointerlockchange', {});
            resolve();
          }
        });
      });
    },
  };
  const lock = new PointerLock(element as unknown as HTMLElement);
  const changes: boolean[] = [];
  lock.onChange = (locked) => changes.push(locked);
  return { lock, changes };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

afterEach(() => {
  delete global.document;
});

describe('PointerLock', () => {
  it('reports no loss for the unadjusted request the plain retry makes up for', async () => {
    const { lock, changes } = page(true);
    lock.request();
    await settle();
    expect(changes).toEqual([true]);
    expect(lock.isLocked()).toBe(true);
  });

  it('reports a request that fails in both modes', async () => {
    const { lock, changes } = page(false);
    lock.request();
    await settle();
    expect(changes).toEqual([false]);
    expect(lock.isLocked()).toBe(false);
  });
});
