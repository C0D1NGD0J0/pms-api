import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { FeatureFlag } from '@interfaces/featureFlag.interface';
import { ISuccessReturnData } from '@interfaces/utils.interface';
import { FeatureFlagService } from '@services/featureFlag/featureFlag.service';
import { SubscriptionPlanConfig } from '@services/subscription/subscription_plans.config';
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
  subscriptionPlanConfig: SubscriptionPlanConfig;
  featureFlagService: FeatureFlagService;
  anthropicService: AnthropicService;
  subscriptionDAO: SubscriptionDAO;
}

// ── Prompt ───────────────────────────────────────────────────────────────────

const INVOICE_EXTRACTION_PROMPT = `You are an invoice data extractor for a property management system. Analyze the uploaded document and extract structured data.

Rules:
- All monetary values MUST be in cents (integer). $185.00 → 18500
- If the invoice has line items, extract each one with description, quantity, unit price (cents), and total (cents)
- If there are no clear line items, create a single line item from the total
- Currency should be a 3-letter ISO code (default: USD)
- Confidence is 0.0-1.0 based on how clearly the document contains invoice data
- If a field is unreadable, omit it from the response
- Do NOT invent data — only extract what is visible
- If the document is NOT an invoice or quote (e.g. a recipe, letter, photo), set confidence to 0.0 and omit all other fields

CRITICAL: Your entire response must be raw JSON only. No markdown fences, no backticks, no explanation text before or after. Start your response with { and end with }.

Success example:
{"description":"Plumbing repair - faucet replacement","amountInCents":18500,"currency":"USD","lineItems":[{"description":"Faucet cartridge","quantity":1,"unitPriceInCents":4500,"amountInCents":4500}],"vendorName":"ABC Plumbing","invoiceNumber":"INV-123","invoiceDate":"2026-05-01","confidence":0.92}

Not-an-invoice example:
{"confidence":0.0}`;

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
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly subscriptionPlanConfig: SubscriptionPlanConfig;

  constructor({
    anthropicService,
    featureFlagService,
    subscriptionDAO,
    subscriptionPlanConfig,
  }: IConstructor) {
    this.log = createLogger('InvoiceAIService');
    this.anthropicService = anthropicService;
    this.featureFlagService = featureFlagService;
    this.subscriptionDAO = subscriptionDAO;
    this.subscriptionPlanConfig = subscriptionPlanConfig;
  }

  async extractInvoiceData(
    fileBuffer: Buffer,
    mimeType: string,
    cuid: string
  ): Promise<ISuccessReturnData<IInvoiceExtractionResult | null>> {
    if (!this.featureFlagService.isEnabled(FeatureFlag.AI_INVOICE_SCANNING)) {
      this.log.info('AI invoice scanning is disabled via feature flag');
      return {
        success: false,
        data: null,
        message: 'AI invoice scanning is not enabled for this account.',
      };
    }

    const subscription = await this.subscriptionDAO.findFirst({ cuid });
    const planName = subscription?.planName ?? 'essential';
    if (!this.subscriptionPlanConfig.hasFeature(planName, 'aiInvoiceScanning')) {
      this.log.info({ planName }, 'AI invoice scanning not available on plan — skipping');
      return {
        success: false,
        data: null,
        message: 'AI invoice scanning is not available on your current plan.',
      };
    }

    if (activeVisionCalls >= MAX_CONCURRENT_VISION_CALLS) {
      this.log.warn(
        { activeVisionCalls, limit: MAX_CONCURRENT_VISION_CALLS },
        'AI invoice scanning rate limit reached — rejecting call'
      );
      return {
        success: false,
        data: null,
        message: 'AI scanning is busy — please try again in a moment.',
      };
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

      const start = result.content.indexOf('{');
      const end = result.content.lastIndexOf('}');
      if (start === -1 || end === -1 || end < start) {
        this.log.error({ content: result.content }, 'AI response contained no JSON object');
        return {
          success: false,
          data: null,
          message: 'AI returned an unreadable response — please try again.',
        };
      }

      const parsed = JSON.parse(result.content.slice(start, end + 1));
      const validated = this.validateResult(parsed);

      if (validated.confidence < 0.1) {
        this.log.warn(
          { confidence: validated.confidence },
          'AI extraction: document does not appear to be an invoice'
        );
        return {
          success: false,
          data: null,
          message: 'The uploaded document does not appear to be an invoice or quote.',
        };
      }

      return { success: true, data: validated };
    } catch (error) {
      this.log.error({ error }, 'AI invoice extraction failed');
      return {
        success: false,
        data: null,
        message: 'Failed to extract invoice data — please try again.',
      };
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
