/**
 * Minimal window/element stand-in for input tests under Node: listeners can be added, removed
 * and fed synthetic events (with a no-op `preventDefault` and `stopPropagation`; a listener's
 * `stopImmediatePropagation` keeps the later listeners from the event).
 */
export class FakeTarget {
  private readonly listeners = new Map<string, Set<(e: unknown) => void>>();

  addEventListener(type: string, fn: (e: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.get(type)?.delete(fn);
  }

  dispatch(type: string, event: Record<string, unknown>) {
    let stopped = false;
    const e = {
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {
        stopped = true;
      },
      ...event,
    };
    for (const fn of this.listeners.get(type) ?? []) {
      fn(e);
      if (stopped) return;
    }
  }
}

/** Installs a FakeTarget as the global `window`; returns it. */
export function installFakeWindow(): FakeTarget {
  const win = new FakeTarget();
  (globalThis as unknown as { window: FakeTarget }).window = win;
  return win;
}

export function removeFakeWindow(): void {
  delete (globalThis as { window?: unknown }).window;
}
