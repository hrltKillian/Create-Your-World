// The interface's typeface (plan v5 « M48 »): Barlow Semi Condensed, SIL Open Font License.
import '@fontsource/barlow-semi-condensed/latin-500.css';
import '@fontsource/barlow-semi-condensed/latin-700.css';
import './ui/styles/main.css';
import './ui/styles/inventory.css';
import './ui/styles/logbook.css';
import './ui/styles/stations.css';
import './ui/styles/menus.css';
import './ui/styles/hud.css';
import { App } from './app/App.ts';
import { applyUiArt } from './ui/uiArt.ts';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root element');
// The interface's pixel art, before anything shows (plan v5 « M48 »).
applyUiArt(document.documentElement);

const app = new App(root, location.search);

if (__DEBUG_HOOK__) {
  const { installDebugHook } = await import('./app/debugHook.ts');
  installDebugHook(app);
}

await app.start();

if (__DEBUG_HOOK__ && app.params.bench) {
  // ?bench=walk|fly|cave|mobs|dig|load runs once the world is up (game-bench: npm run bench).
  const { runBenchFromUrl } = await import('./app/bench/autorun.ts');
  await runBenchFromUrl(app, app.params.bench);
}

if (__DEBUG_HOOK__ && app.params.selftest) {
  // The 'app is ready' case reports boot failures; a banner is always shown.
  const { runSelftests } = await import('./app/selftest/runner.ts');
  await runSelftests(app, app.params.selftest);
}
