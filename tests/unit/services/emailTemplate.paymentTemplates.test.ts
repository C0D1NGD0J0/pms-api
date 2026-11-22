import { EmailTemplateService } from '@services/emailTemplate/emailTemplate.service';

describe('EmailTemplateService — payment notice templates', () => {
  const service = new EmailTemplateService();

  const expectations: Record<string, string[]> = {
    PAD_PRE_DEBIT_NOTIFICATION: ['Aug 1, 2026', 'ending in 6789', 'www.payments.ca'],
    PAD_MANDATE_CONFIRMATION: ['mandate_1PqRsT', 'right to receive reimbursement', '10 days'],
    PAD_DEBIT_INITIATED: ['processing', 'PYT-ABC123'],
    PAYMENT_RETRIED_WITH_CARD: ['ending in 4242', 'Insufficient funds'],
    PAYMENT_REFUNDED: ['partial', 'Overpayment'],
    DEPOSIT_REFUND_FAILED: ['Bank account closed', 'PYT-DEP456'],
  };

  it('lists the new payment templates', async () => {
    const templateTypes = (await service.getTemplateList()).map((t) => t.templateType);
    expect(templateTypes).toEqual(expect.arrayContaining(Object.keys(expectations)));
  });

  it.each(Object.entries(expectations))(
    'renders %s with its mock data',
    async (templateType, expectedSnippets) => {
      const html = await service.renderPreview(templateType);

      expect(html).toContain('<html');
      for (const snippet of expectedSnippets) {
        expect(html).toContain(snippet);
      }
    }
  );

  it.each(Object.keys(expectations))('exposes metadata for %s', async (templateType) => {
    const metadata = await service.getTemplateMetadata(templateType);
    expect(metadata.htmlContent.length).toBeGreaterThan(0);
    expect(metadata.textContent.length).toBeGreaterThan(0);
  });
});
