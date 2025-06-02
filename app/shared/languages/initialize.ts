import { languageService } from './language.service';

/**
 * Initialize language service with retries
 * @param maxRetries - maximum number of retry attempts
 * @param delay - delay between retries in milliseconds
 */
export async function initializeLanguageServiceWithRetries(
  maxRetries: number = 3,
  delay: number = 1000
): Promise<void> {
  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      await initializeLanguageService();
      return;
    } catch (error) {
      attempts++;

      if (attempts >= maxRetries) {
        console.error(
          `❌ Failed to initialize language service after ${maxRetries} attempts:`,
          error
        );
        throw error;
      }

      console.warn(
        `⚠️ Language service initialization attempt ${attempts} failed, retrying in ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Initialize the language service
 * This should be called once during application startup
 */
export async function initializeLanguageService(): Promise<void> {
  try {
    await languageService.initialize();
    console.log('✅ Language service initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize language service:', error);
    throw error;
  }
}
