import { t } from '../i18n/i18n.ts';
import type { InputManager } from '../input/InputManager.ts';
import {
  clickToPlay,
  setClickToPlayControls,
  setClickToPlayResume,
} from '../ui/screens/clickToPlay.ts';
import type { GameSession } from './GameSession.ts';

/** What the gate tells the app: play stopped (show the pause menu) or started again. */
export interface GateEvents {
  paused(): void;
  playing(): void;
}

/**
 * Click-to-play gate of a session (docs/conception.md « Pointer Lock »): without the mouse
 * captured the game is paused and ignores the keyboard. The overlay shows the controls on the
 * player's layout and asks for the first click. Losing the lock while playing pauses the game
 * (the app shows the pause menu, whose Resume captures the mouse again).
 * Screens (the bag) release the mouse themselves and the world keeps running behind them:
 * closing one with its own key captures the mouse again, closing it with Esc shows the overlay
 * (« Click to resume »). Without Pointer Lock (`?noLock=1`) there is no overlay and screens only
 * take the keyboard.
 */
export class PlayGate {
  private readonly input: InputManager;
  private readonly session: GameSession;
  private readonly events: GateEvents;
  private readonly click: HTMLElement | null = null;
  private screenOpen = false;
  private playing = true;

  constructor(
    layer: HTMLElement,
    input: InputManager,
    session: GameSession,
    layoutLoaded: Promise<void>,
    events: GateEvents,
  ) {
    this.input = input;
    this.session = session;
    this.events = events;
    const pointer = input.pointer;
    if (!pointer) {
      input.enabled = true;
      return;
    }
    const click = clickToPlay(controlsText(input), () => pointer.request());
    this.click = click;
    layer.append(click);
    void layoutLoaded.then(() => setClickToPlayControls(click, controlsText(input)));
    this.setPlaying(false);
    pointer.onChange = (locked) => {
      // The game released the mouse to show a screen: nothing pauses.
      if (!locked && this.screenOpen) return;
      this.setPlaying(locked);
      if (locked) this.events.playing();
      else {
        click.hidden = true;
        this.events.paused();
      }
    };
  }

  /** True while playing: the mouse is captured (or there is no Pointer Lock) and no screen is up. */
  canOpenScreen(): boolean {
    return !this.screenOpen && this.playing;
  }

  /** The pause menu may open: no screen (the bag) is up. */
  canPause(): boolean {
    return !this.screenOpen;
  }

  /**
   * A screen holds the gate (keyboard taken, mouse free), even between two screens: a chest
   * closed by a death leaves it to the death screen.
   */
  screenIsOpen(): boolean {
    return this.screenOpen;
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

  /** The pause menu opens: no ticks, no keys, the mouse free and the overlay out of the way. */
  pause(): void {
    this.setPlaying(false);
    if (this.click) this.click.hidden = true;
    this.input.pointer?.exit();
  }

  /**
   * Resume (a click on the pause menu, a user gesture): captures the mouse, and play starts once
   * it is captured (`playing()`); without Pointer Lock at once.
   */
  resume(): void {
    const pointer = this.input.pointer;
    if (pointer) pointer.request();
    else {
      this.setPlaying(true);
      this.events.playing();
    }
  }

  /** The world closes: the overlay goes and the lock no longer reports here. */
  dispose(): void {
    this.click?.remove();
    const pointer = this.input.pointer;
    if (pointer) {
      pointer.onChange = null;
      pointer.exit();
    }
  }

  private setPlaying(playing: boolean): void {
    this.playing = playing;
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
