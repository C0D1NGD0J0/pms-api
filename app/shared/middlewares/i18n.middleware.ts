import { NextFunction, Response, Request } from 'express';
import { LanguageService } from '@shared/languages/language.service';

interface I18nRequest extends Request {
  t?: (key: string, params?: Record<string, string | number>) => string;
  language?: string;
}

interface I18nConstructor {
  languageService: LanguageService;
}

export class I18nMiddleware {
  private languageService: LanguageService;

  constructor({ languageService }: I18nConstructor) {
    this.languageService = languageService;
  }

  /**
   * Middleware to detect and set language based on request headers or query params
   */
  detectLanguage = (req: I18nRequest, _res: Response, next: NextFunction) => {
    // Priority order: query param > header > default
    const language =
      (req.query.lang as string) ||
      req.headers['accept-language']?.split(',')[0]?.split('-')[0] ||
      'en';

    // Validate language is supported
    const supportedLanguages = this.languageService.getAvailableLanguages();
    const selectedLanguage = supportedLanguages.includes(language) ? language : 'en';

    // Set language for this request
    this.languageService.setLanguage(selectedLanguage);

    // Add language info to request object
    req.language = selectedLanguage;

    // Add translation function to request for convenience
    req.t = (key: string, params?: Record<string, string | number>) => {
      return this.languageService.t(key, params);
    };

    next();
  };

  /**
   * Middleware to set language from user preferences (after authentication)
   * Priority: user.preferences.lang > client.settings.lang > profile.lang > request.lang > default
   */
  setUserLanguage = async (req: I18nRequest, _res: Response, next: NextFunction) => {
    try {
      const currentUser = req.context?.currentuser;
      let userLanguage = req.language || 'en';

      if (currentUser) {
        // Priority 1: User preferences language
        if (currentUser.preferences?.lang) {
          userLanguage = currentUser.preferences.lang;
        }
        // Priority 2: Client settings language (if available in context)
        else if ((currentUser as any).clientSettings?.lang) {
          userLanguage = (currentUser as any).clientSettings.lang;
        }
        // Priority 3: Profile language (if available through context)
        else if ((currentUser as any).profile?.lang) {
          userLanguage = (currentUser as any).profile.lang;
        }
      }

      const supportedLanguages = this.languageService.getAvailableLanguages();
      const selectedLanguage = supportedLanguages.includes(userLanguage) ? userLanguage : 'en';

      await this.languageService.setLanguage(selectedLanguage);
      req.language = selectedLanguage;

      req.t = (key: string, params?: Record<string, string | number>) => {
        return this.languageService.t(key, params);
      };

      next();
    } catch (error) {
      console.error('Error in setUserLanguage middleware:', error);
      // Continue with existing language settings
      next();
    }
  };
}
