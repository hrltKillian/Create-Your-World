/** Engine strings (English). Content names live in the content pack's own i18n file. */
export const en = {
  'app.title': 'Create Your World',
  'app.tagline': 'Start with nothing. Build everything.',
  'app.milestone': 'Prototype · milestone {n}',
  'boot.loading': 'Loading…',
  'error.unsupported.title': 'This browser cannot run Create Your World',
  'error.unsupported.intro': 'Some required features are missing:',
  'error.unsupported.webgl2': 'WebGL 2 with texture arrays (hardware acceleration must be on)',
  'error.unsupported.moduleWorkers': 'Module web workers',
  'error.unsupported.pointerLock': 'Pointer Lock (mouse capture)',
  'error.unsupported.hint':
    'Create Your World runs best in an up-to-date Google Chrome on a desktop computer.',
  'error.touch.notice': 'This game is designed for a keyboard and a mouse.',
  'error.fatal.title': 'Something went wrong',
  'error.fatal.intro': 'The game hit an unexpected error and had to stop.',
  'error.fatal.reload': 'Reload',
} as const;

export type EngineStringKey = keyof typeof en;
