import fs from 'fs';
import ejs from 'ejs';
import path from 'path';
import { createLogger } from '@utils/index';

/**
 * Generic data contract for rendering any invoice.
 * Callers build this struct from their domain data and hand it to
 * `InvoiceTemplateRenderer.render()`.
 */
export interface InvoiceRenderData {
  /** Reference block (right column in header) */
  reference: {
    label: string;
    entries: InvoiceReferenceEntry[];
  };
  /** Bill-to / recipient block */
  billTo: {
    label: string;
    name: string;
    address: string;
  };
  /** Optional subtotal rows before grand total */
  subtotals?: InvoiceSubtotal[];
  /** Line items table */
  lineItems: InvoiceLineItem[];
  /** Optional key-value detail rows (section between parties and line items) */
  details?: InvoiceDetail[];

  /** Light variant of accent color for gradient. Default: "#60a5fa" (blue-400) */
  accentColorLight?: string;

  /** Title for the line items section (default: "Amount Breakdown") */
  lineItemsTitle?: string;

  /** Subtitle under company name (e.g. "Payment Invoice", "Expense Report") */
  documentTitle: string;
  /** Unique invoice / receipt number */
  invoiceNumber: string;

  /** Title for the details section (default: "Details") */
  detailsTitle?: string;
  /** Accent color (CSS value). Default: "#2563eb" (blue-600) */
  accentColor?: string;

  /** Top-left company / issuer name */
  companyName: string;
  /** Human-readable status label (e.g. "PAID", "PENDING") */
  statusLabel: string;

  /** Pre-formatted grand total (e.g. "CAD 1,250.00") */
  totalAmount: string;
  /** Optional footer note (HTML allowed). Falls back to "Generated on <date>." */
  footerNote?: string;

  /** Status key used to pick badge colors (lowercase, e.g. "paid", "overdue") */
  statusKey: string;
  /** Optional notes block at the bottom */
  notes?: string;
}

/**
 * A single line item on the invoice (e.g. "Rent", "Processing Fee").
 */
export interface InvoiceLineItem {
  description: string;
  /** Pre-formatted amount string, e.g. "CAD 1,200.00" */
  amount: string;
}

/**
 * A subtotal row shown between line items and the grand total
 * (e.g. "Subtotal", "Tax", "Discount").
 */
export interface InvoiceSubtotal {
  /** Pre-formatted amount string */
  amount: string;
  label: string;
}

/**
 * Reference entries shown in the header area (e.g. Lease #, Period, Due Date).
 */
export interface InvoiceReferenceEntry {
  value: string;
  key: string;
}

/**
 * A key-value detail row shown above the line-items table
 * (e.g. "Payment Method → Credit Card").
 */
export interface InvoiceDetail {
  value: string;
  key: string;
}

const STATUS_BADGE: Record<string, { bg: string; fg: string }> = {
  paid: { bg: '#dcfce7', fg: '#166534' },
  pending: { bg: '#fef9c3', fg: '#854d0e' },
  overdue: { bg: '#fee2e2', fg: '#991b1b' },
  failed: { bg: '#fee2e2', fg: '#991b1b' },
  cancelled: { bg: '#f3f4f6', fg: '#6b7280' },
  refunded: { bg: '#dbeafe', fg: '#1e40af' },
  partial: { bg: '#e0e7ff', fg: '#3730a3' },
};

const DEFAULT_BADGE = { bg: '#f3f4f6', fg: '#6b7280' };
const DEFAULT_ACCENT = '#2563eb';
const DEFAULT_ACCENT_LIGHT = '#60a5fa';

export class InvoiceTemplateRenderer {
  private readonly log = createLogger('InvoiceTemplateRenderer');
  private readonly templatesPath: string;

  constructor() {
    this.templatesPath = path.join(__dirname, '../../templates/invoice');
  }

  /**
   * Render an invoice to an HTML string.
   *
   * @param data  Generic invoice data — the caller is responsible for
   *              formatting monetary amounts and dates before passing them in.
   * @param templateName  EJS file name without extension (default: "standard").
   */
  async render(data: InvoiceRenderData, templateName = 'standard'): Promise<string> {
    const badge = STATUS_BADGE[data.statusKey] ?? DEFAULT_BADGE;

    const templateData = {
      ...data,
      accentColor: data.accentColor ?? DEFAULT_ACCENT,
      accentColorLight: data.accentColorLight ?? DEFAULT_ACCENT_LIGHT,
      statusBadge: badge,
      detailsTitle: data.detailsTitle ?? 'Details',
      lineItemsTitle: data.lineItemsTitle ?? 'Amount Breakdown',
      subtotals: data.subtotals ?? [],
      generatedDate: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    };

    const fileName = `${templateName}.ejs`;
    const templatePath = path.join(this.templatesPath, fileName);

    // Security: prevent path traversal
    const resolvedPath = path.resolve(templatePath);
    const resolvedDir = path.resolve(this.templatesPath);
    if (!resolvedPath.startsWith(resolvedDir + path.sep) && resolvedPath !== resolvedDir) {
      throw new Error('Invalid template path — potential path traversal detected');
    }

    try {
      await fs.promises.access(resolvedPath, fs.constants.R_OK);
    } catch {
      throw new Error(`Invoice template not found: ${fileName}`);
    }

    const templateContent = await fs.promises.readFile(resolvedPath, 'utf8');

    const html = await ejs.render(templateContent, templateData, {
      filename: resolvedPath,
      async: true,
    });

    this.log.info({ templateName }, 'Invoice template rendered');
    return html;
  }
}
