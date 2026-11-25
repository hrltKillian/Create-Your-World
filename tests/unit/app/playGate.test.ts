import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameSession } from '../../../src/app/GameSession.ts';
import { PlayGate } from '../../../src/app/playGate.ts';
import { t } from '../../../src/i18n/i18n.ts';
import type { InputManager } from '../../../src/input/InputManager.ts';
import { type FakeElement, installFakeDom, removeFakeDom } from '../../helpers/fakeDom.ts';

/*
 * The click-to-play gate against a Pointer Lock stand-in: closing a screen (its key, Esc, the
 * simulation) goes back to play without the pause menu, behind a light « Click to resume » prompt
 * when the browser refuses the lock; only Esc in play with no screen pauses.
 */

/** Pointer Lock whose requests the test answers, as the browser would: taken, lost or refused. */
class FakePointer {
  locked = false;
  requests = 0;
  exits = 0;
  onChange: ((locked: boolean) => void) | null = null;

  isLocked(): boolean {
    return this.locked;
  }

  request(): void {
    this.requests++;
  }

  exit(): void {
    this.exits++;
  }

  /** The browser's answer: the lock taken (true), or lost or refused (false). */
  answer(locked: boolean): void {
    this.locked = locked;
    this.onChange?.(locked);
  }
}

beforeEach(installFakeDom);
afterEach(removeFakeDom);

/** A gate whose first click has captured the mouse: playing. */
function setup() {
  const pointer = new FakePointer();
  const input = { pointer, enabled: false, releaseAll() {}, keyLabel: () => 'W' };
  const session = {
    paused: false,
    setPaused(paused: boolean) {
      this.paused = paused;
    },
  };
  const events = { paused: 0, playing: 0 };
  const layer = document.createElement('div') as unknown as FakeElement;
  const gate = new PlayGate(
    layer as unknown as HTMLElement,
    input as unknown as InputManager,
    session as unknown as GameSession,
    Promise.resolve(),
    { paused: () => events.paused++, playing: () => events.playing++ },
  );
  const click = layer.childNodes[0] as FakeElement;
  expect(session.paused).toBe(true);
  click.dispatch('click');
  expect(pointer.requests).toBe(1);
  pointer.answer(true);
  expect(input.enabled).toBe(true);
  /** A screen opens (the mouse freed by the game: no pause). */
  const openScreen = () => {
    gate.openScreen();
    pointer.answer(false);
  };
  return { gate, pointer, input, session, events, click, openScreen };
}

describe('PlayGate', () => {
  it('goes back to play when a screen closes, capturing the mouse again, without a pause', () => {
    const { gate, pointer, input, session, events, click, openScreen } = setup();
    openScreen();
    expect(input.enabled).toBe(false);
    gate.closeScreen();
    // The keyboard plays at once; the simulation never stopped.
    expect(input.enabled).toBe(true);
    expect(session.paused).toBe(false);
    expect(pointer.requests).toBe(2);
    pointer.answer(true);
    expect(click.hidden).toBe(true);
    expect(events).toEqual({ paused: 0, playing: 2 });
    expect(gate.canOpenScreen()).toBe(true);
  });

  it('shows the light prompt when the browser refuses the lock (Esc), and play goes on', () => {
    const { gate, pointer, input, session, events, click, openScreen } = setup();
    openScreen();
    gate.closeScreen();
    pointer.answer(false);
    expect(events.paused).toBe(0);
    expect(session.paused).toBe(false);
    expect(input.enabled).toBe(true);
    expect(click.hidden).toBe(false);
    expect(click.classList.contains('click-light')).toBe(true);
    expect(click.querySelector('.click-title')!.textContent).toBe(t('play.resume'));
    // The bag may open again from there, which hides the prompt.
    expect(gate.canOpenScreen()).toBe(true);
    openScreen();
    expect(click.hidden).toBe(true);
    gate.closeScreen();
    pointer.answer(false);
    // A click on the prompt that the browser refuses keeps it; a granted one plays on.
    click.dispatch('click');
    pointer.answer(false);
    expect(click.hidden).toBe(false);
    expect(events.paused).toBe(0);
    click.dispatch('click');
    pointer.answer(true);
    expect(click.hidden).toBe(true);
    expect(session.paused).toBe(false);
    expect(pointer.requests).toBe(5);
  });

  it('pauses on Esc in play with no screen open, and the pause menu may open from the prompt', () => {
    const { gate, pointer, input, session, events, click, openScreen } = setup();
    pointer.answer(false);
    expect(events.paused).toBe(1);
    expect(session.paused).toBe(true);
    expect(input.enabled).toBe(false);
    expect(click.hidden).toBe(true);
    // Resume, a screen, then Esc on the prompt: the app opens the pause menu.
    gate.resume();
    pointer.answer(true);
    openScreen();
    gate.closeScreen();
    pointer.answer(false);
    gate.pause();
    expect(session.paused).toBe(true);
    expect(click.hidden).toBe(true);
    expect(input.enabled).toBe(false);
  });

  it('keeps the mouse free for a screen opened before a pending lock was granted', () => {
    const { gate, pointer, input, openScreen } = setup();
    openScreen();
    gate.closeScreen();
    openScreen();
    const exits = pointer.exits;
    pointer.answer(true);
    expect(pointer.exits).toBe(exits + 1);
    expect(input.enabled).toBe(false);
    expect(gate.canOpenScreen()).toBe(false);
  });

  it('keeps the pause menu when a lock asked for as a screen closed is granted after the pause', () => {
    const { gate, pointer, input, session, events, openScreen } = setup();
    openScreen();
    gate.closeScreen();
    // Esc again before the browser answers: the pause menu opens, and the late lock is let go.
    gate.pause();
    const exits = pointer.exits;
    pointer.answer(true);
    expect(pointer.exits).toBe(exits + 1);
    pointer.answer(false);
    expect(session.paused).toBe(true);
    expect(input.enabled).toBe(false);
    expect(events).toEqual({ paused: 0, playing: 1 });
    // Only Resume plays again (at once, then once more when the lock is granted).
    gate.resume();
    pointer.answer(true);
    expect(session.paused).toBe(false);
    expect(input.enabled).toBe(true);
    expect(events).toEqual({ paused: 0, playing: 3 });
  });

  it('plays again at Resume even when the browser refuses the lock, behind the light prompt', () => {
    const { gate, pointer, input, session, events, click } = setup();
    // Esc in play: the lock is lost and the pause menu opens.
    pointer.answer(false);
    gate.pause();
    // Resume right away: Chrome refuses a lock just after Esc released one.
    gate.resume();
    expect(session.paused).toBe(false);
    expect(input.enabled).toBe(true);
    pointer.answer(false);
    expect(session.paused).toBe(false);
    expect(events.paused).toBe(1);
    expect(click.hidden).toBe(false);
    expect(click.classList.contains('click-light')).toBe(true);
  });

  it('opens the pause menu over an open screen, which Resume finds open again', () => {
    const { gate, pointer, input, session, openScreen } = setup();
    openScreen();
    gate.pause();
    expect(session.paused).toBe(true);
    expect(gate.screenIsOpen()).toBe(true);
    expect(gate.canOpenScreen()).toBe(false);
    const requests = pointer.requests;
    gate.resume();
    // The screen keeps the keyboard and the mouse: no lock is asked for.
    expect(session.paused).toBe(false);
    expect(input.enabled).toBe(false);
    expect(pointer.requests).toBe(requests);
    expect(gate.screenIsOpen()).toBe(true);
    gate.closeScreen();
    expect(input.enabled).toBe(true);
    expect(pointer.requests).toBe(requests + 1);
  });
});
