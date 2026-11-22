import './ui/styles/main.css';
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
  const { runSelftests } = await import('./app/selftest/runner.ts');
  await app.ready();
  await runSelftests(app, app.params.selftest);
}
