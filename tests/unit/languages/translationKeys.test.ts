import fs from 'fs';
import path from 'path';
import i18next from 'i18next';
import en from '@shared/languages/locales/en.json';
import fr from '@shared/languages/locales/fr.json';
import { I18nextConfig } from '@shared/languages/i18next.config';

// Every fixed key passed to t('…') in app code must exist, or users see the raw key
// (e.g. "lease.errors.rentMustBePositive") instead of a message. en-nig falls back to en.

const APP_DIR = path.join(__dirname, '../../../app');
const T_CALL = /\bt\(\s*['"]([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)['"]/g;

const listTsFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listTsFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });

const usedKeys = (): Map<string, string> => {
  const keys = new Map<string, string>();
  for (const file of listTsFiles(APP_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(T_CALL)) {
      if (!keys.has(match[1])) keys.set(match[1], path.relative(APP_DIR, file));
    }
  }
  return keys;
};

const hasKey = (messages: Record<string, unknown>, key: string): boolean =>
  key.split('.').reduce<unknown>((node, part) => {
    return node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
  }, messages) !== undefined;

describe('translation keys used in app code', () => {
  const keys = usedKeys();

  it('finds the t() calls it checks', () => {
    expect(keys.size).toBeGreaterThan(100);
  });

  it.each([
    ['en', en],
    ['fr', fr],
  ])('all exist in %s', (_locale, messages) => {
    const missing = [...keys]
      .filter(([key]) => !hasKey(messages as Record<string, unknown>, key))
      .map(([key, file]) => `${key} (${file})`);

    expect(missing).toEqual([]);
  });

  it('falls back to English for en-nig, so its keys never show raw', async () => {
    await I18nextConfig.getInstance().initialize();
    const nigerianEnglish = i18next.getFixedT('en-nig');

    // A key that only exists in en.json
    expect(nigerianEnglish('lease.errors.rentMustBePositive')).toBe('Rent must be greater than 0');
  });
});
