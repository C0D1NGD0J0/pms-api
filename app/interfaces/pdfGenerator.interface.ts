import { PDFOptions } from 'puppeteer';

import { ResourceInfo } from './utils.interface';

export interface PdfGenerationOptions extends Partial<PDFOptions> {
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  format?: 'Letter' | 'Legal' | 'A4';
  displayHeaderFooter?: boolean;
  /** Must be true to preserve CSS backgrounds, borders, and colors from templates */
  printBackground?: boolean;
  /** Can use special classes: date, title, url, pageNumber, totalPages */
  headerTemplate?: string;
  /** Can use special classes: date, title, url, pageNumber, totalPages */
  footerTemplate?: string;
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

export interface BrowserLaunchConfig {
  headless?: boolean | 'shell';
  executablePath?: string;
  timeout?: number;
  args?: string[];
}
