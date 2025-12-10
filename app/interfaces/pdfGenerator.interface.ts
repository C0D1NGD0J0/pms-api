import { PDFOptions } from 'puppeteer';

import { ResourceInfo } from './utils.interface';

export interface PdfGenerationOptions extends Partial<PDFOptions> {
  /**
   * Page margins
   * Default: { top: '1in', right: '1in', bottom: '1in', left: '1in' }
   * Matches the @page { margin: 1in; } in your EJS templates
   */
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };

  /**
   * Page format - default 'Letter' (8.5" x 11")
   * Your EJS templates use Letter size
   */
  format?: 'Letter' | 'Legal' | 'A4';

  /**
   * Display header and footer with page numbers
   * Default: true
   */
  displayHeaderFooter?: boolean;

  /**
   * Print background graphics
   * MUST be true to preserve CSS backgrounds, borders, and colors from templates
   * Default: true
   */
  printBackground?: boolean;

  /**
   * HTML template for header
   * Can use special classes: date, title, url, pageNumber, totalPages
   */
  headerTemplate?: string;

  /**
   * HTML template for footer
   * Can use special classes: date, title, url, pageNumber, totalPages
   * Default: Page numbers centered
   */
  footerTemplate?: string;
}

export interface BrowserLaunchConfig {
  /**
   * Run in headless mode
   * Default: 'new' (modern headless mode)
   * Set to false for debugging
   */
  headless?: boolean | 'shell';

  /**
   * Path to Chrome executable (auto-detected if not provided)
   */
  executablePath?: string;

  /**
   * Browser launch timeout in milliseconds
   * Default: 30000 (30 seconds)
   */
  timeout?: number;

  /**
   * Chrome/Chromium arguments for optimization
   */
  args?: string[];
}

export interface PdfGeneratorStats {
  lastError?: {
    message: string;
    timestamp: Date;
  };
  averageGenerationTime: number;
  totalGenerated: number;
  browserUptime: number;
  totalErrors: number;
}

export interface PdfGenerationResult {
  metadata?: {
    pageCount?: number;
    fileSize?: number;
    generationTime?: number;
  };
  success: boolean;
  buffer?: Buffer;
  error?: string;
}

export interface PdfJobResult {
  resource?: PdfJobData['resource'];
  generationTime?: number;
  fileSize?: number;
  success: boolean;
  pdfUrl?: string;
  s3Key?: string;
  error?: string;
}

export interface PdfJobData {
  senderInfo?: {
    email: string;
    name: string;
  };
  resource: ResourceInfo;
  templateType?: string;
  cuid: string;
}
