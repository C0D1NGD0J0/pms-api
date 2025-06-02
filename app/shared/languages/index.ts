export { languageService, LanguageService } from './language.service';
export * from './types';
export { I18nextConfig } from './i18next.config';
export { initializeLanguageService, initializeLanguageServiceWithRetries } from './initialize';

// Simple helper function for easy access to translation service
export const t = (key: string, params?: Record<string, string | number>) => {
  return languageService.t(key, params);
};
