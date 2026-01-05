import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import puppeteer, { Browser, Page } from 'puppeteer';
import {
  PdfGenerationOptions,
  PdfGenerationResult,
  BrowserLaunchConfig,
  PdfGeneratorStats,
} from '@interfaces/pdfGenerator.interface';

export class PdfGeneratorService {
  private browser: Browser | null = null; // singleton browser instance
  private browserInitPromise: Promise<Browser> | null = null; // Track ongoing initialization
  private lastUsed: Date | null = null; // Track last usage time
  private cleanupTimer: NodeJS.Timeout | null = null; // Idle cleanup timer
  private readonly logger: Logger;
  private stats: PdfGeneratorStats;
  private browserLaunchTime: Date | null = null;
  private readonly BROWSER_IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes idle timeout

  constructor() {
    this.logger = createLogger('PdfGeneratorService');
    this.stats = {
      totalGenerated: 0,
      totalErrors: 0,
      averageGenerationTime: 0,
      browserUptime: 0,
    };
    this.logger.info(
      `PdfGeneratorService initialized with ${this.BROWSER_IDLE_TIMEOUT / 1000}s idle timeout`
    );
  }

  async generatePdf(html: string, options?: PdfGenerationOptions): Promise<PdfGenerationResult> {
    const startTime = Date.now();
    let page: Page | null = null;

    try {
      this.logger.info('Starting PDF generation...');
      const browser = await this.getBrowser();
      page = await browser.newPage();

      // Set HTML content and wait for resources to load
      await page.setContent(html, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });

      // pdf options optimized for legal documents
      const pdfOptions: PdfGenerationOptions = {
        format: options?.format ?? 'Letter',
        printBackground: options?.printBackground ?? true, // important for CSS
        margin: options?.margin ?? {
          top: '1in',
          right: '1in',
          bottom: '1in',
          left: '1in',
        },
        displayHeaderFooter: options?.displayHeaderFooter ?? true, // Page numbers
        footerTemplate:
          options?.footerTemplate ??
          `
          <div style="font-size: 9px; text-align: center; width: 100%; color: #666; padding: 10px 0;">
            Page <span class="pageNumber"></span> of <span class="totalPages"></span>
          </div>
        `,
        headerTemplate: options?.headerTemplate ?? '<div></div>', // Empty header
        scale: options?.scale ?? 1,
        ...options,
      };

      // generate PDF buffer
      const buffer = await page.pdf(pdfOptions);
      const generationTime = Date.now() - startTime;

      // Update stats
      this.updateStats(true, generationTime);

      this.logger.info(
        {
          fileSize: buffer.length,
          generationTime,
        },
        'PDF generated successfully'
      );

      return {
        success: true,
        buffer: Buffer.from(buffer),
        metadata: {
          fileSize: buffer.length,
          generationTime,
        },
      };
    } catch (error) {
      const generationTime = Date.now() - startTime;
      this.updateStats(false, generationTime, error);

      this.logger.error({ error, generationTime }, 'PDF generation failed');

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        metadata: {
          generationTime,
        },
      };
    } finally {
      // Always close the page to free memory
      if (page) {
        try {
          await page.close();
          this.logger.debug('Page closed successfully');
        } catch (error) {
          this.logger.warn({ error }, 'Failed to close page');
        }
      }
    }
  }

  getStats(): PdfGeneratorStats {
    return { ...this.stats };
  }

  async cleanup(): Promise<void> {
    // Clear any pending cleanup timer
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.browser) {
      try {
        this.logger.info('Closing browser and freeing memory...');
        await this.browser.close();
        this.browser = null;
        this.browserLaunchTime = null;
        this.lastUsed = null;
        this.logger.info('Browser closed successfully - memory freed');
      } catch (error) {
        this.logger.error({ error }, 'Failed to close browser');
      }
    }
  }

  /**
   * Reset the idle cleanup timer
   * Schedules browser cleanup after BROWSER_IDLE_TIMEOUT of inactivity
   */
  private resetCleanupTimer(): void {
    // Clear existing timer
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
    }

    // Schedule cleanup after idle timeout
    this.cleanupTimer = setTimeout(async () => {
      if (this.browser && this.lastUsed) {
        const idleTime = Date.now() - this.lastUsed.getTime();
        if (idleTime >= this.BROWSER_IDLE_TIMEOUT) {
          this.logger.info(
            `Browser idle for ${idleTime / 1000}s (threshold: ${this.BROWSER_IDLE_TIMEOUT / 1000}s), closing to free memory...`
          );
          await this.cleanup();
        }
      }
    }, this.BROWSER_IDLE_TIMEOUT);
  }

  private updateStats(success: boolean, generationTime: number, error?: unknown): void {
    if (success) {
      this.stats.totalGenerated++;

      // Calculate rolling average
      const total = this.stats.totalGenerated + this.stats.totalErrors;
      this.stats.averageGenerationTime =
        (this.stats.averageGenerationTime * (total - 1) + generationTime) / total;
    } else {
      this.stats.totalErrors++;
      this.stats.lastError = {
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date(),
      };
    }

    // Update browser uptime
    if (this.browserLaunchTime) {
      this.stats.browserUptime = Date.now() - this.browserLaunchTime.getTime();
    }
  }

  private async initBrowser(config?: BrowserLaunchConfig): Promise<Browser> {
    try {
      this.logger.info('Initializing Puppeteer browser...');

      const defaultArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-web-security',
      ];

      // Use system Chrome if available (production), otherwise use bundled Chrome (local development)
      const executablePath =
        process.env.PUPPETEER_EXECUTABLE_PATH || config?.executablePath || undefined;

      this.browser = await puppeteer.launch({
        headless: true,
        args: config?.args ?? defaultArgs,
        executablePath,
        timeout: config?.timeout ?? 30000,
      });

      this.browserLaunchTime = new Date();

      // log which type of Chrome is being used for debugging
      const chromeUsed = executablePath || 'bundled';
      this.logger.info(
        {
          executablePath: chromeUsed,
          browserVersion: await this.browser.version(),
        },
        'Browser initialized successfully'
      );

      this.browser.on('disconnected', () => {
        this.logger.warn('Browser disconnected. Will reinitialize on next request.');
        this.browser = null;
        this.browserLaunchTime = null;
      });

      return this.browser;
    } catch (error) {
      this.logger.error(
        {
          error,
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'not set',
        },
        'Failed to initialize browser'
      );
      throw new Error(`Failed to launch Puppeteer browser: ${error}`);
    }
  }

  private async getBrowser(): Promise<Browser> {
    // Update last used timestamp
    this.lastUsed = new Date();

    // Return existing browser if connected
    if (this.browser?.connected) {
      this.resetCleanupTimer();
      return this.browser;
    }

    // If browser is being initialized, wait for it
    if (this.browserInitPromise) {
      this.logger.info('Browser initialization in progress, waiting...');
      return this.browserInitPromise;
    }

    // Initialize new browser
    this.logger.info('Browser not initialized or disconnected. Creating new instance...');
    this.browserInitPromise = this.initBrowser();

    try {
      this.browser = await this.browserInitPromise;
      this.resetCleanupTimer();
      return this.browser;
    } finally {
      // Clear the promise after initialization completes (success or failure)
      this.browserInitPromise = null;
    }
  }
}
