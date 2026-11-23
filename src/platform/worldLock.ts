/** A world held by this tab (docs « Sauvegarde », « Verrou »). */
export interface WorldLock {
  /** Lets the world go; resolves once another tab can take it. */
  release(): Promise<void>;
}

/** What the lock needs of the Web Locks API (`navigator.locks`). */
export type LockRequester = Pick<LockManager, 'request'>;

/**
 * Takes the Web Lock of a world until `release()`: null when another tab has the world open (this
 * tab shows a message). Without Web Locks every tab gets the world.
 */
export function lockWorld(
  worldId: string,
  locks: LockRequester | null = navigator.locks ?? null,
): Promise<WorldLock | null> {
  if (!locks) return Promise.resolve({ release: async () => {} });
  return new Promise((resolve, reject) => {
    // Settles once the lock is released (the callback runs later, so `held` is set by then).
    const held: Promise<unknown> = locks.request(
      `cyw.world.${worldId}`,
      { ifAvailable: true },
      (lock) => {
        if (!lock) {
          resolve(null);
          return undefined;
        }
        // The lock is held until this promise settles.
        return new Promise<void>((done) =>
          resolve({
            release: async () => {
              done();
              await held;
            },
          }),
        );
      },
    );
    held.catch(reject);
  });
}
