import type { AudioEngine } from '../audio/AudioEngine.ts';
import type { Registry } from '../content/registry.ts';
import type { UiCue, UiPanel } from '../ui/slotBoard.ts';

/*
 * The interface's sounds (plan v5 « M54 »): every screen and menu names what happened (a button,
 * a tab, a stack taken, put or thrown, a panel opening or closing), the pack's `sounds.ui` says
 * how it sounds, on the interface's bus.
 */

export function playUiCue(registry: Registry, audio: AudioEngine, cue: UiCue): void {
  const ui = registry.pack.sounds?.ui;
  if (ui) audio.playUi(ui[cue]);
}

export function playUiPanel(
  registry: Registry,
  audio: AudioEngine,
  panel: UiPanel,
  open: boolean,
): void {
  const ui = registry.pack.sounds?.ui;
  if (ui) audio.playUi(open ? ui[panel].open : ui[panel].close);
}
