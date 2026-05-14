import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { FeatureFlag } from '@interfaces/featureFlag.interface';
import { FeatureFlagService } from '@services/featureFlag/featureFlag.service';
import {
  AnthropicContentBlock,
  AnthropicService,
} from '@services/external/anthropic/anthropic.service';

// ── Result interface ─────────────────────────────────────────────────────────

export interface IInvoiceExtractionResult {
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPriceInCents: number;
    amountInCents: number;
  }>;
  invoiceNumber?: string;
  amountInCents: number;
  invoiceDate?: string;
  description: string;
  vendorName?: string;
  confidence: number;
  currency: string;
}

// ── Constructor ──────────────────────────────────────────────────────────────

interface IConstructor {
  featureFlagService: FeatureFlagService;
  anthropicService: AnthropicService;
}

// ── Prompt ───────────────────────────────────────────────────────────────────

const INVOICE_EXTRACTION_PROMPT = `You are an invoice data extractor for a property management system. Analyze the uploaded invoice document and extract structured data.

Rules:
- All monetary values MUST be in cents (integer). $185.00 → 18500
- If the invoice has line items, extract each one with description, quantity, unit price (cents), and total (cents)
- If there are no clear line items, create a single line item from the total
- Currency should be a 3-letter ISO code (default: USD)
- Confidence is 0.0-1.0 based on how clearly you can read the document
- If a field is unreadable, omit it from the response
- Do NOT invent data — only extract what is visible

Respond ONLY with this JSON schema (no markdown, no explanation):
{
  "description": "Brief summary of what the invoice is for",
  "amountInCents": 18500,
  "currency": "USD",
  "lineItems": [
    { "description": "Faucet cartridge", "quantity": 1, "unitPriceInCents": 4500, "amountInCents": 4500 }
  ],
  "vendorName": "Company name if visible",
  "invoiceNumber": "INV-123 if visible",
  "invoiceDate": "2026-05-01 if visible",
  "confidence": 0.92
}`;

// ── Field length caps ─────────────────────────────────────────────────────────

const MAX_DESCRIPTION_LEN = 500;
const MAX_LINE_ITEM_DESC_LEN = 200;
const MAX_VENDOR_NAME_LEN = 200;
const MAX_INVOICE_NUMBER_LEN = 50;
const MAX_INVOICE_DATE_LEN = 20;

// ── Cost guard ───────────────────────────────────────────────────────────────
// Limits concurrent vision API calls across the entire process to prevent runaway costs.
// Vision calls (PDF + image) are significantly more expensive than text calls.
// Phase 2: replace with a Redis-based per-tenant daily quota.

const MAX_CONCURRENT_VISION_CALLS = 3;
let activeVisionCalls = 0;

// ── Service ──────────────────────────────────────────────────────────────────

export class InvoiceAIService {
  private readonly log: Logger;
  private readonly anthropicService: AnthropicService;
  private readonly featureFlagService: FeatureFlagService;

  constructor({ anthropicService, featureFlagService }: IConstructor) {
    this.log = createLogger('InvoiceAIService');
    this.anthropicService = anthropicService;
    this.featureFlagService = featureFlagService;
  }

  async extractInvoiceData(
    fileBuffer: Buffer,
    mimeType: string
  ): Promise<IInvoiceExtractionResult | null> {
    if (!this.featureFlagService.isEnabled(FeatureFlag.AI_INVOICE_SCANNING)) {
      this.log.info('AI invoice scanning is disabled via feature flag');
      return null;
    }

    if (activeVisionCalls >= MAX_CONCURRENT_VISION_CALLS) {
      this.log.warn(
        { activeVisionCalls, limit: MAX_CONCURRENT_VISION_CALLS },
        'AI invoice scanning rate limit reached — rejecting call'
      );
      return null;
    }

    activeVisionCalls++;
    try {
      const isPdf = mimeType === 'application/pdf';
      const mediaType = this.mapMimeType(mimeType);

      const contentBlocks: AnthropicContentBlock[] = isPdf
        ? [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: fileBuffer.toString('base64'),
              },
            } as any,
          ]
        : [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
                data: fileBuffer.toString('base64'),
              },
            },
          ];

      // Append the extraction instruction as a text block
      contentBlocks.push({
        type: 'text',
        text: 'Extract the invoice data from this document.',
      });

      const result = await this.anthropicService.createVisionMessage(
        INVOICE_EXTRACTION_PROMPT,
        contentBlocks,
        { temperature: 0.1, maxTokens: 1024 }
      );

      this.log.info(
        { inputTokens: result.inputTokens, outputTokens: result.outputTokens, model: result.model },
        'Invoice AI extraction complete'
      );

      const parsed = JSON.parse(result.content);
      return this.validateResult(parsed);
    } catch (error) {
      this.log.error({ error }, 'AI invoice extraction failed');
      return null;
    } finally {
      activeVisionCalls--;
    }
  }

  private mapMimeType(mime: string): string {
    const map: Record<string, string> = {
      'image/jpeg': 'image/jpeg',
      'image/jpg': 'image/jpeg',
      'image/png': 'image/png',
      'image/webp': 'image/webp',
      'application/pdf': 'application/pdf',
    };
    return map[mime] || 'image/jpeg';
  }

  private validateResult(parsed: any): IInvoiceExtractionResult {
    const amountInCents =
      typeof parsed.amountInCents === 'number' && Number.isInteger(parsed.amountInCents)
        ? parsed.amountInCents
        : 0;

    // Validate currency: must be exactly 3 uppercase letters
    const rawCurrency =
      typeof parsed.currency === 'string' ? parsed.currency.trim().toUpperCase() : '';
    const currency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : 'USD';

    const lineItems = Array.isArray(parsed.lineItems)
      ? parsed.lineItems
          .filter(
            (item: any) =>
              typeof item.description === 'string' &&
              typeof item.quantity === 'number' &&
              typeof item.unitPriceInCents === 'number' &&
              typeof item.amountInCents === 'number'
          )
          .map((item: any) => ({
            description: String(item.description).slice(0, MAX_LINE_ITEM_DESC_LEN),
            quantity: item.quantity,
            unitPriceInCents: Math.round(item.unitPriceInCents),
            amountInCents: Math.round(item.amountInCents),
          }))
      : [];

    const rawDescription = typeof parsed.description === 'string' ? parsed.description : '';
    const rawVendorName = typeof parsed.vendorName === 'string' ? parsed.vendorName : undefined;
    const rawInvoiceDate = typeof parsed.invoiceDate === 'string' ? parsed.invoiceDate : undefined;
    const rawInvoiceNumber =
      typeof parsed.invoiceNumber === 'string' ? parsed.invoiceNumber : undefined;

    return {
      description: rawDescription.slice(0, MAX_DESCRIPTION_LEN),
      amountInCents,
      currency,
      lineItems,
      vendorName: rawVendorName ? rawVendorName.slice(0, MAX_VENDOR_NAME_LEN) : undefined,
      invoiceDate: rawInvoiceDate ? rawInvoiceDate.slice(0, MAX_INVOICE_DATE_LEN) : undefined,
      invoiceNumber: rawInvoiceNumber
        ? rawInvoiceNumber.slice(0, MAX_INVOICE_NUMBER_LEN)
        : undefined,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    };
  }
}
