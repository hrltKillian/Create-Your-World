import './ui/styles/main.css';
import './ui/styles/inventory.css';
import { App } from './app/App.ts';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root element');

const app = new App(root, location.search);

if (__DEBUG_HOOK__) {
  const { installDebugHook } = await import('./app/debugHook.ts');
  installDebugHook(app);
}

await app.start();

if (__DEBUG_HOOK__ && app.params.selftest) {
  // The 'app is ready' case reports boot failures; a banner is always shown.
  const { runSelftests } = await import('./app/selftest/runner.ts');
  await runSelftests(app, app.params.selftest);
}
