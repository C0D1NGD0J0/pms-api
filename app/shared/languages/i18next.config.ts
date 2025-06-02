import path from 'path';
import i18next from 'i18next';
import Backend from 'i18next-fs-backend';

export class I18nextConfig {
  private static instance: I18nextConfig;
  private initialized = false;

  private constructor() {}

  static getInstance(): I18nextConfig {
    if (!I18nextConfig.instance) {
      I18nextConfig.instance = new I18nextConfig();
    }
    return I18nextConfig.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await i18next.use(Backend).init({
      lng: 'en', // default language
      fallbackLng: 'en',
      supportedLngs: ['en', 'fr'],

      // Backend configuration for file loading
      backend: {
        loadPath: path.join(__dirname, 'locales/{{lng}}.json'),
        addPath: path.join(__dirname, 'locales/{{lng}}.missing.json'),
      },

      // Interpolation settings
      interpolation: {
        escapeValue: false, // React already escapes values
        format: (value, format) => {
          if (format === 'uppercase') return value.toUpperCase();
          if (format === 'lowercase') return value.toLowerCase();
          return value;
        },
      },

      // Development settings
      debug: process.env.NODE_ENV === 'development',
      saveMissing: process.env.NODE_ENV === 'development',

      // Resource settings
      load: 'languageOnly', // Load 'en' instead of 'en-US'

      // Parsing settings
      parseMissingKeyHandler: (key: string) => {
        console.warn(`Missing translation key: ${key}`);
        return key;
      },
    });

    this.initialized = true;
  }

  getInstance(): typeof i18next {
    return i18next;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async changeLanguage(language: string): Promise<void> {
    await i18next.changeLanguage(language);
  }

  getCurrentLanguage(): string {
    return i18next.language;
  }

  getAvailableLanguages(): string[] {
    return i18next.options.supportedLngs?.filter((lng) => lng !== 'cimode') || ['en'];
  }

  t(key: string, options?: any): string {
    return i18next.t(key, options);
  }
}
