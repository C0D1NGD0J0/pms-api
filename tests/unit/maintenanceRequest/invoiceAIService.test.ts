import { FeatureFlag } from '@interfaces/featureFlag.interface';
import { InvoiceAIService } from '@services/ai/invoiceAI.service';
import { FeatureFlagService } from '@services/featureFlag/featureFlag.service';
import { AnthropicService } from '@services/external/anthropic/anthropic.service';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockAnthropicService = {
  createMessage: jest.fn(),
  createVisionMessage: jest.fn(),
} as unknown as AnthropicService;

const mockFeatureFlagService = {
  isEnabled: jest.fn(),
} as unknown as FeatureFlagService;

// ── Service under test ───────────────────────────────────────────────────────

let service: InvoiceAIService;

beforeEach(() => {
  jest.clearAllMocks();
  service = new InvoiceAIService({
    anthropicService: mockAnthropicService,
    featureFlagService: mockFeatureFlagService,
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockVisionResponse(payload: object) {
  (mockAnthropicService.createVisionMessage as jest.Mock).mockReturnValue(
    Promise.resolve({
      content: JSON.stringify(payload),
      inputTokens: 1500,
      outputTokens: 200,
      model: 'claude-haiku-4-5-20251001',
    })
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('InvoiceAIService', () => {
  describe('extractInvoiceData', () => {
    it('returns failure when feature flag is disabled', async () => {
      (mockFeatureFlagService.isEnabled as jest.Mock).mockReturnValue(false);

      const result = await service.extractInvoiceData(Buffer.from('fake-image'), 'image/jpeg');

      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(mockFeatureFlagService.isEnabled).toHaveBeenCalledWith(
        FeatureFlag.AI_INVOICE_SCANNING
      );
      expect(mockAnthropicService.createVisionMessage).not.toHaveBeenCalled();
    });

    it('returns extracted data from a valid API response', async () => {
      (mockFeatureFlagService.isEnabled as jest.Mock).mockReturnValue(true);
      mockVisionResponse({
        description: 'Plumbing repair',
        amountInCents: 18500,
        currency: 'USD',
        lineItems: [
          { description: 'Faucet cartridge', quantity: 1, unitPriceInCents: 4500, amountInCents: 4500 },
          { description: 'Labor', quantity: 2, unitPriceInCents: 7000, amountInCents: 14000 },
        ],
        vendorName: "Joe's Plumbing",
        invoiceNumber: 'INV-001',
        invoiceDate: '2026-05-01',
        confidence: 0.95,
      });

      const result = await service.extractInvoiceData(Buffer.from('fake-image-data'), 'image/jpeg');

      expect(result.success).toBe(true);
      expect(result.data).not.toBeNull();
      expect(result.data!.description).toBe('Plumbing repair');
      expect(result.data!.amountInCents).toBe(18500);
      expect(result.data!.currency).toBe('USD');
      expect(result.data!.lineItems).toHaveLength(2);
      expect(result.data!.lineItems[0].description).toBe('Faucet cartridge');
      expect(result.data!.vendorName).toBe("Joe's Plumbing");
      expect(result.data!.invoiceNumber).toBe('INV-001');
      expect(result.data!.confidence).toBe(0.95);
    });

    it('returns failure when API call throws', async () => {
      (mockFeatureFlagService.isEnabled as jest.Mock).mockReturnValue(true);
      (mockAnthropicService.createVisionMessage as jest.Mock).mockReturnValue(
        Promise.reject(new Error('API unavailable'))
      );

      const result = await service.extractInvoiceData(Buffer.from('fake-image'), 'image/jpeg');

      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.message).toBeDefined();
    });

    it('returns failure when confidence is below threshold', async () => {
      (mockFeatureFlagService.isEnabled as jest.Mock).mockReturnValue(true);
      mockVisionResponse({
        description: '',
        amountInCents: 0,
        currency: 'USD',
        lineItems: [],
        confidence: 0.05,
      });

      const result = await service.extractInvoiceData(Buffer.from('fake-image'), 'image/jpeg');

      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
    });

    it('validates and sanitizes malformed response data', async () => {
      (mockFeatureFlagService.isEnabled as jest.Mock).mockReturnValue(true);
      mockVisionResponse({
        description: 123, // wrong type — should become ''
        amountInCents: 'not-a-number', // wrong type — should become 0
        lineItems: [
          { description: 'Valid', quantity: 1, unitPriceInCents: 100, amountInCents: 100 },
          { description: 'Missing fields' }, // incomplete — should be filtered
        ],
        confidence: 0.8,
      });

      const result = await service.extractInvoiceData(Buffer.from('fake-image'), 'image/png');

      expect(result.success).toBe(true);
      expect(result.data!.description).toBe('');
      expect(result.data!.amountInCents).toBe(0);
      expect(result.data!.lineItems).toHaveLength(1); // only the valid item
      expect(result.data!.currency).toBe('USD'); // default
    });

    it('handles PDF files — passes document content block to AnthropicService', async () => {
      (mockFeatureFlagService.isEnabled as jest.Mock).mockReturnValue(true);
      mockVisionResponse({
        description: 'PDF Invoice',
        amountInCents: 5000,
        currency: 'USD',
        lineItems: [],
        confidence: 0.88,
      });

      const result = await service.extractInvoiceData(Buffer.from('fake-pdf-data'), 'application/pdf');

      expect(result.success).toBe(true);
      expect(result.data!.description).toBe('PDF Invoice');

      const [, contentBlocks] = (mockAnthropicService.createVisionMessage as jest.Mock).mock.calls[0];
      expect(contentBlocks[0]).toMatchObject({ type: 'document' });
    });

    it('handles image files — passes image content block to AnthropicService', async () => {
      (mockFeatureFlagService.isEnabled as jest.Mock).mockReturnValue(true);
      mockVisionResponse({
        description: 'Image Invoice',
        amountInCents: 3000,
        currency: 'USD',
        lineItems: [],
        confidence: 0.9,
      });

      await service.extractInvoiceData(Buffer.from('fake-png'), 'image/png');

      const [, contentBlocks] = (mockAnthropicService.createVisionMessage as jest.Mock).mock.calls[0];
      expect(contentBlocks[0]).toMatchObject({ type: 'image' });
    });

    it('routes through AnthropicService (not a direct Anthropic client)', async () => {
      (mockFeatureFlagService.isEnabled as jest.Mock).mockReturnValue(true);
      mockVisionResponse({ description: 'ok', amountInCents: 100, currency: 'USD', lineItems: [], confidence: 0.5 });

      await service.extractInvoiceData(Buffer.from('data'), 'image/jpeg');

      expect(mockAnthropicService.createVisionMessage).toHaveBeenCalledTimes(1);
    });

    it('strips markdown fences from AI response before parsing', async () => {
      (mockFeatureFlagService.isEnabled as jest.Mock).mockReturnValue(true);
      // Simulate AI wrapping response in markdown fences despite instructions
      (mockAnthropicService.createVisionMessage as jest.Mock).mockReturnValue(
        Promise.resolve({
          content: '```json\n{"description":"Fix tap","amountInCents":5000,"currency":"USD","lineItems":[],"confidence":0.9}\n```',
          inputTokens: 100,
          outputTokens: 50,
          model: 'claude-haiku-4-5-20251001',
        })
      );

      const result = await service.extractInvoiceData(Buffer.from('data'), 'image/jpeg');

      expect(result.success).toBe(true);
      expect(result.data!.description).toBe('Fix tap');
    });

    describe('field length limits', () => {
      beforeEach(() => {
        (mockFeatureFlagService.isEnabled as jest.Mock).mockReturnValue(true);
      });

      it('truncates description to 500 characters', async () => {
        mockVisionResponse({
          description: 'D'.repeat(600),
          amountInCents: 1000,
          currency: 'USD',
          lineItems: [],
          confidence: 0.8,
        });
        const result = await service.extractInvoiceData(Buffer.from('data'), 'image/jpeg');
        expect(result.data!.description).toHaveLength(500);
      });

      it('truncates vendorName to 200 characters', async () => {
        mockVisionResponse({
          description: 'ok',
          amountInCents: 1000,
          currency: 'USD',
          vendorName: 'V'.repeat(300),
          lineItems: [],
          confidence: 0.8,
        });
        const result = await service.extractInvoiceData(Buffer.from('data'), 'image/jpeg');
        expect(result.data!.vendorName).toHaveLength(200);
      });

      it('truncates invoiceNumber to 50 characters', async () => {
        mockVisionResponse({
          description: 'ok',
          amountInCents: 1000,
          currency: 'USD',
          invoiceNumber: 'I'.repeat(100),
          lineItems: [],
          confidence: 0.8,
        });
        const result = await service.extractInvoiceData(Buffer.from('data'), 'image/jpeg');
        expect(result.data!.invoiceNumber).toHaveLength(50);
      });

      it('truncates line item description to 200 characters', async () => {
        mockVisionResponse({
          description: 'ok',
          amountInCents: 1000,
          currency: 'USD',
          lineItems: [
            {
              description: 'L'.repeat(300),
              quantity: 1,
              unitPriceInCents: 1000,
              amountInCents: 1000,
            },
          ],
          confidence: 0.8,
        });
        const result = await service.extractInvoiceData(Buffer.from('data'), 'image/jpeg');
        expect(result.data!.lineItems[0].description).toHaveLength(200);
      });

      it('rejects invalid currency and falls back to USD', async () => {
        mockVisionResponse({
          description: 'ok',
          amountInCents: 1000,
          currency: 'INVALID_CURRENCY',
          lineItems: [],
          confidence: 0.8,
        });
        const result = await service.extractInvoiceData(Buffer.from('data'), 'image/jpeg');
        expect(result.data!.currency).toBe('USD');
      });

      it('accepts valid 3-letter ISO currency codes', async () => {
        mockVisionResponse({
          description: 'ok',
          amountInCents: 1000,
          currency: 'CAD',
          lineItems: [],
          confidence: 0.8,
        });
        const result = await service.extractInvoiceData(Buffer.from('data'), 'image/jpeg');
        expect(result.data!.currency).toBe('CAD');
      });

      it('normalises lowercase currency to uppercase', async () => {
        mockVisionResponse({
          description: 'ok',
          amountInCents: 1000,
          currency: 'eur',
          lineItems: [],
          confidence: 0.8,
        });
        const result = await service.extractInvoiceData(Buffer.from('data'), 'image/jpeg');
        expect(result.data!.currency).toBe('EUR');
      });
    });
  });
});
