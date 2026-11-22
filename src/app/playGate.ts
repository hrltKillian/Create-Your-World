import { t } from '../i18n/i18n.ts';
import type { InputManager } from '../input/InputManager.ts';
import {
  clickToPlay,
  setClickToPlayControls,
  setClickToPlayResume,
} from '../ui/screens/clickToPlay.ts';
import type { GameSession } from './GameSession.ts';

/**
 * Click-to-play gate of a Pointer Lock session: without the mouse captured the game is paused and
 * ignores the keyboard. The overlay shows the controls on the player's layout, asks for a click
 * and comes back (as "resume") whenever the lock is lost. Does nothing without Pointer Lock.
 */
export function installPlayGate(
  root: HTMLElement,
  input: InputManager,
  session: GameSession,
  layoutLoaded: Promise<void>,
): void {
  const pointer = input.pointer;
  if (!pointer) return;
  const click = clickToPlay(controlsText(input), () => pointer.request());
  root.append(click);
  void layoutLoaded.then(() => setClickToPlayControls(click, controlsText(input)));
  const setPlaying = (playing: boolean) => {
    session.paused = !playing;
    input.enabled = playing;
    if (!playing) input.releaseAll();
  };
  setPlaying(false);
  pointer.onChange = (locked) => {
    click.hidden = locked;
    setPlaying(locked);
    if (!locked) {
      setClickToPlayResume(click);
      setClickToPlayControls(click, controlsText(input));
    }
  };
}

/** Controls line with the labels of the player's own keyboard layout. */
function controlsText(input: InputManager): string {
  return t('play.controls', {
    forward: input.keyLabel('forward'),
    left: input.keyLabel('left'),
    back: input.keyLabel('back'),
    right: input.keyLabel('right'),
    jump: input.keyLabel('jump'),
    sprint: input.keyLabel('sprint'),
    crouch: input.keyLabel('crouch'),
    camera: input.keyLabel('camera'),
  });
}
