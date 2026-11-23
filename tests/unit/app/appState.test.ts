import { describe, expect, it } from 'vitest';
import { type AppEvent, type AppState, MenuNav, nextState } from '../../../src/app/appState.ts';

/** Runs events from a state; null as soon as one is refused. */
function run(from: AppState, events: readonly AppEvent[]): AppState | null {
  let state: AppState | null = from;
  for (const event of events) state = state && nextState(state, event);
  return state;
}

describe('app state machine', () => {
  it('goes menu → loading → world ⇄ paused ⇄ quitting → menu', () => {
    expect(run('boot', ['menu'])).toBe('menu');
    expect(run('menu', ['open'])).toBe('loading');
    expect(run('menu', ['open', 'loaded'])).toBe('world');
    const play = ['open', 'loaded', 'pause', 'resume', 'pause', 'quit'] as const;
    expect(run('menu', play)).toBe('quitting');
    expect(run('menu', [...play, 'menu'])).toBe('menu');
  });

  it('goes back to the pause menu when the last save fails, to retry or quit', () => {
    expect(run('paused', ['quit', 'quitFailed'])).toBe('paused');
    expect(run('paused', ['quit', 'quitFailed', 'quit', 'menu'])).toBe('menu');
    expect(run('paused', ['quit', 'quitFailed', 'resume'])).toBe('world');
    for (const state of ['menu', 'loading', 'world', 'paused'] as const)
      expect(nextState(state, 'quitFailed')).toBeNull();
  });

  it('boots straight into a world, and goes back to the menu when it cannot be opened', () => {
    expect(run('boot', ['open', 'loaded'])).toBe('world');
    expect(run('boot', ['open', 'menu'])).toBe('menu');
  });

  it('shows the loading screen again in an unloaded area, and pauses while loading', () => {
    expect(run('world', ['unloaded'])).toBe('loading');
    expect(run('loading', ['pause'])).toBe('paused');
    // Resume goes back to play; the frame loop reports 'unloaded' if the area is not ready.
    expect(run('loading', ['pause', 'resume', 'unloaded', 'loaded'])).toBe('world');
  });

  it('refuses events a state does not take', () => {
    expect(nextState('world', 'quit')).toBeNull(); // quit only from the pause menu
    expect(nextState('paused', 'menu')).toBeNull(); // only once saved
    expect(nextState('quitting', 'resume')).toBeNull(); // no way back while the save runs
    expect(nextState('paused', 'pause')).toBeNull();
    expect(nextState('world', 'resume')).toBeNull();
    expect(nextState('loading', 'open')).toBeNull(); // a second click on Play
    expect(nextState('menu', 'loaded')).toBeNull();
    for (const event of [
      'menu',
      'open',
      'loaded',
      'pause',
      'resume',
      'quit',
      'quitFailed',
    ] as const) {
      expect(nextState('fatal', event)).toBeNull();
      expect(nextState('testchunk', event)).toBeNull();
    }
  });
});

describe('menu navigation', () => {
  it('opens screens on a root and goes back one at a time', () => {
    const nav = new MenuNav();
    expect(nav.current).toBeNull();
    nav.reset('main');
    nav.open('worlds');
    nav.open('newWorld');
    expect(nav.current).toBe('newWorld');
    expect(nav.back()).toBe(true);
    expect(nav.current).toBe('worlds');
    expect(nav.back()).toBe(true);
    expect(nav.back()).toBe(false);
    expect(nav.current).toBe('main');
  });

  it('does not stack a screen on itself, and starts over on reset', () => {
    const nav = new MenuNav();
    nav.reset('pause');
    nav.open('settings');
    nav.open('settings');
    expect(nav.back()).toBe(true);
    expect(nav.current).toBe('pause');
    nav.open('settings');
    nav.reset('main');
    expect(nav.back()).toBe(false);
    nav.close();
    expect(nav.current).toBeNull();
  });
});
