import { I18nextConfig } from './i18next.config';
import { ILanguageService, LanguageParams, LanguageKey } from './types';

export class LanguageService implements ILanguageService {
  private i18nextConfig: I18nextConfig;
  private initialized = false;

  constructor() {
    this.i18nextConfig = I18nextConfig.getInstance();
  }

  async initialize(): Promise<void> {
    if (!this.initialized) {
      await this.i18nextConfig.initialize();
      this.initialized = true;
    }
  }

  /**
   * Translate a key with optional parameters
   * @param key - nested key (e.g., 'auth.errors.unauthorized')
   * @param params - optional parameters for string interpolation
   * @returns translated string
   */
  t(key: LanguageKey, params?: LanguageParams): string {
    if (!this.initialized) {
      console.warn('LanguageService not initialized. Call initialize() first.');
      return key;
    }

    try {
      return this.i18nextConfig.t(key, params);
    } catch (error) {
      console.error(`Translation error for key "${key}":`, error);
      return key;
    }
  }

  /**
   * Set the current language
   * @param language - language code (e.g., 'en', 'fr')
   */
  async setLanguage(language: string): Promise<void> {
    if (!this.initialized) {
      console.warn('LanguageService not initialized. Call initialize() first.');
      return;
    }

    try {
      await this.i18nextConfig.changeLanguage(language);
    } catch (error) {
      console.error(`Error changing language to "${language}":`, error);
    }
  }

  /**
   * Get the current language code
   * @returns current language code
   */
  getCurrentLanguage(): string {
    if (!this.initialized) {
      return 'en';
    }
    return this.i18nextConfig.getCurrentLanguage();
  }

  /**
   * Get list of available languages
   * @returns array of available language codes
   */
  getAvailableLanguages(): string[] {
    if (!this.initialized) {
      return ['en'];
    }
    return this.i18nextConfig.getAvailableLanguages();
  }

  /**
   * Check if the service is initialized
   * @returns boolean indicating initialization status
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Set language based on user preferences with fallback priority
   * Priority: userPrefs.lang > clientSettings.lang > profileLang > fallback
   * @param userPrefs - user preferences object
   * @param clientSettings - client settings object
   * @param profileLang - profile language string
   * @param fallback - fallback language (default: 'en')
   */
  async setLanguageFromUserData(
    userPrefs?: { lang?: string },
    clientSettings?: { lang?: string },
    profileLang?: string,
    fallback: string = 'en'
  ): Promise<string> {
    let selectedLanguage = fallback;

    // Priority 1: User preferences
    if (userPrefs?.lang) {
      selectedLanguage = userPrefs.lang;
    }
    // Priority 2: Client settings
    else if (clientSettings?.lang) {
      selectedLanguage = clientSettings.lang;
    }
    // Priority 3: Profile language
    else if (profileLang) {
      selectedLanguage = profileLang;
    }

    // Validate language is supported
    const supportedLanguages = this.getAvailableLanguages();
    if (!supportedLanguages.includes(selectedLanguage)) {
      selectedLanguage = fallback;
    }

    await this.setLanguage(selectedLanguage);
    return selectedLanguage;
  }

  /**
   * Set language for a specific user context (useful in services)
   * @param userId - user ID for context
   * @param userData - user data containing language preferences
   */
  async setUserContextLanguage(
    userId: string,
    userData: {
      preferences?: { lang?: string };
      client?: { settings?: { lang?: string } };
      profile?: { lang?: string };
    }
  ): Promise<void> {
    await this.setLanguageFromUserData(
      userData.preferences,
      userData.client?.settings,
      userData.profile?.lang
    );
  }
}

// Create a singleton instance for backwards compatibility
export const languageService = new LanguageService();
