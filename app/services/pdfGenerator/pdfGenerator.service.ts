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
  private readonly logger: Logger;
  private stats: PdfGeneratorStats;
  private browserLaunchTime: Date | null = null;

  constructor() {
    this.logger = createLogger('PdfGeneratorService');
    this.stats = {
      totalGenerated: 0,
      totalErrors: 0,
      averageGenerationTime: 0,
      browserUptime: 0,
    };
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
    if (this.browser) {
      try {
        this.logger.info('Closing browser...');
        await this.browser.close();
        this.browser = null;
        this.browserLaunchTime = null;
        this.logger.info('Browser closed successfully');
      } catch (error) {
        this.logger.error({ error }, 'Failed to close browser');
      }
    }
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

      this.browser = await puppeteer.launch({
        headless: config?.headless ?? true, // ← Changed from 'new' to true
        args: config?.args ?? defaultArgs,
        executablePath: config?.executablePath,
        timeout: config?.timeout ?? 30000,
      });

      this.browserLaunchTime = new Date();
      this.logger.info('Browser initialized successfully');

      this.browser.on('disconnected', () => {
        this.logger.warn('Browser disconnected. Will reinitialize on next request.');
        this.browser = null;
        this.browserLaunchTime = null;
      });

      return this.browser;
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize browser');
      throw new Error(`Failed to launch Puppeteer browser: ${error}`);
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.connected) {
      return this.browser;
    }
    this.logger.info('Browser not initialized or disconnected. Creating new instance...');
    return this.initBrowser();
  }
}
