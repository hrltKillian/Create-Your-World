import { t } from '../i18n/i18n.ts';
import type { InputManager } from '../input/InputManager.ts';
import {
  clickToPlay,
  setClickToPlayControls,
  showResumePrompt,
} from '../ui/screens/clickToPlay.ts';
import type { GameSession } from './GameSession.ts';

/** What the gate tells the app: play stopped (show the pause menu) or started again. */
export interface GateEvents {
  paused(): void;
  playing(): void;
}

/**
 * Click-to-play gate of a session (docs/conception.md « Pointer Lock »): before the first click
 * the game is paused and ignores the keyboard; the overlay shows the controls on the player's
 * layout and asks for that click. Losing the lock while playing (Esc) pauses the game (the app
 * shows the pause menu, whose Resume captures the mouse again).
 * Screens (the bag, a chest, a station) release the mouse themselves and the world keeps running
 * behind them. Closing one, whatever closed it (its key, Esc, the simulation), goes back to play
 * at once and captures the mouse again; when the browser refuses (Esc is no user gesture), play
 * goes on with the keyboard behind a light « Click to resume » prompt, never the pause menu.
 * Without Pointer Lock (`?noLock=1`) there is no overlay and screens only take the keyboard.
 */
export class PlayGate {
  private readonly input: InputManager;
  private readonly session: GameSession;
  private readonly events: GateEvents;
  private readonly click: HTMLElement | null = null;
  private screenOpen = false;
  private playing = true;
  /** A screen closed and the mouse is not captured again yet: play goes on, a refusal prompts. */
  private relocking = false;
  /** The pause menu is up: only its Resume plays again (a late lock granted meanwhile is let go). */
  private menuPaused = false;

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
      if (locked && (this.screenOpen || this.menuPaused)) {
        // A lock asked for before a screen opened again or the game paused: the mouse stays free.
        pointer.exit();
      } else if (locked) {
        this.relocking = false;
        this.setPlaying(true);
        this.events.playing();
      } else if (this.relocking) {
        // The lock asked for when a screen closed (or by a click on the prompt) was refused.
        showResumePrompt(click);
      } else if (!this.screenOpen && !this.menuPaused) {
        // Esc while playing (not the game releasing the mouse for a screen or the pause menu).
        this.setPlaying(false);
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
    this.relocking = false;
    this.input.enabled = false;
    this.input.releaseAll();
    if (this.click) this.click.hidden = true;
    this.input.pointer?.exit();
  }

  /**
   * Back to the game without a pause: the keyboard plays at once and the mouse is captured again
   * (the light « Click to resume » prompt shows if the browser refuses).
   */
  closeScreen(): void {
    this.screenOpen = false;
    this.input.enabled = true;
    const pointer = this.input.pointer;
    if (!pointer) return;
    this.relocking = true;
    pointer.request();
  }

  /** The pause menu opens: no ticks, no keys, the mouse free and the overlay out of the way. */
  pause(): void {
    this.menuPaused = true;
    this.relocking = false;
    this.setPlaying(false);
    if (this.click) this.click.hidden = true;
    this.input.pointer?.exit();
  }

  /**
   * Resume (a click on the pause menu, a user gesture): captures the mouse, and play starts once
   * it is captured (`playing()`); without Pointer Lock at once.
   */
  resume(): void {
    this.menuPaused = false;
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
