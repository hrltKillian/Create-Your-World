import { t } from '../i18n/i18n.ts';
import type { InputManager } from '../input/InputManager.ts';
import {
  clickToPlay,
  setClickToPlayControls,
  setClickToPlayResume,
} from '../ui/screens/clickToPlay.ts';
import type { GameSession } from './GameSession.ts';

/**
 * Click-to-play gate of a session (docs/conception.md « Pointer Lock »): without the mouse
 * captured the game is paused and ignores the keyboard. The overlay shows the controls on the
 * player's layout, asks for a click and comes back (as "resume") whenever the lock is lost.
 * Screens (the bag) release the mouse themselves and the world keeps running behind them:
 * closing one with its own key captures the mouse again, closing it with Esc shows the overlay.
 * Without Pointer Lock (`?noLock=1`) there is no overlay and screens only take the keyboard.
 */
export class PlayGate {
  private readonly input: InputManager;
  private readonly session: GameSession;
  private readonly click: HTMLElement | null = null;
  private screenOpen = false;

  constructor(
    root: HTMLElement,
    input: InputManager,
    session: GameSession,
    layoutLoaded: Promise<void>,
  ) {
    this.input = input;
    this.session = session;
    const pointer = input.pointer;
    if (!pointer) return;
    const click = clickToPlay(controlsText(input), () => pointer.request());
    this.click = click;
    root.append(click);
    void layoutLoaded.then(() => setClickToPlayControls(click, controlsText(input)));
    this.setPlaying(false);
    pointer.onChange = (locked) => {
      // The game released the mouse to show a screen: nothing pauses.
      if (!locked && this.screenOpen) return;
      this.setPlaying(locked);
      if (!locked) this.showResume();
    };
  }

  /** True while playing: the mouse is captured (or there is no Pointer Lock) and no screen is up. */
  canOpenScreen(): boolean {
    return !this.screenOpen && (this.input.pointer?.isLocked() ?? true);
  }

  /** A screen takes the keyboard and frees the mouse; the simulation keeps running. */
  openScreen(): void {
    this.screenOpen = true;
    this.input.enabled = false;
    this.input.releaseAll();
    this.input.pointer?.exit();
  }

  /**
   * Back to the game. `relock` (the screen's own key: a user gesture) captures the mouse again;
   * otherwise (Esc) the game pauses until a click. A refused lock also ends on the overlay.
   */
  closeScreen(relock: boolean): void {
    this.screenOpen = false;
    const pointer = this.input.pointer;
    if (!pointer) {
      this.input.enabled = true;
      return;
    }
    if (relock) {
      pointer.request();
      return;
    }
    this.setPlaying(false);
    this.showResume();
  }

  private setPlaying(playing: boolean): void {
    this.session.setPaused(!playing);
    this.input.enabled = playing;
    if (!playing) this.input.releaseAll();
    if (this.click) this.click.hidden = playing;
  }

  private showResume(): void {
    if (!this.click) return;
    setClickToPlayResume(this.click);
    setClickToPlayControls(this.click, controlsText(this.input));
  }
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
    bag: input.keyLabel('inventory'),
    drop: input.keyLabel('drop'),
    camera: input.keyLabel('camera'),
  });
}
