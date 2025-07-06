export { languageService, LanguageService } from './language.service';
export { I18nextConfig } from './i18next.config';
export * from './types';

import { languageService as langService } from './language.service';

export const t = (key: string, params?: Record<string, string | number>) => {
  return langService.t(key, params);
};
