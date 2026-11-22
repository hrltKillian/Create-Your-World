import { describe, expect, it } from 'vitest';
import { addStrings, i18nMissing, t } from '../../../src/i18n/i18n.ts';

describe('i18n', () => {
  it('returns English engine strings with placeholders', () => {
    expect(t('app.title')).toBe('Create Your World');
    expect(t('app.milestone', { n: 3 })).toBe('Prototype · milestone 3');
  });

  it('records missing keys and lets packs add strings', () => {
    expect(t('test.unknown.key')).toBe('test.unknown.key');
    expect(i18nMissing()).toContain('test.unknown.key');
    addStrings({ 'test.added': 'Added {what}' });
    expect(t('test.added', { what: 'string' })).toBe('Added string');
  });
});
