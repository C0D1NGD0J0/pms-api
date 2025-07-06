export interface ILanguageService {
  t(key: LanguageKey, params?: LanguageParams): string;
  setLanguage(language: string): void;
  getAvailableLanguages(): string[];
  getCurrentLanguage(): string;
}
export type LanguageParams = Record<string, string | number>;

export type LanguageDictionary = Record<string, any>;

export type LanguageKey = string;
