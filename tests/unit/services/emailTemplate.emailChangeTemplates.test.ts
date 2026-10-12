import { EmailTemplateService } from '@services/emailTemplate/emailTemplate.service';

describe('EmailTemplateService — email change templates', () => {
  const service = new EmailTemplateService();

  it('renders the verification email with the confirm link and requester', async () => {
    const html = await service.renderPreview('EMAIL_CHANGE_VERIFICATION');

    expect(html).toContain('<html');
    expect(html).toContain('jane.new@example.com');
    expect(html).toContain('Alex Manager');
    expect(html).toContain('/email_change/confirm?t=sample-token-abc123');
    expect(html).toContain('24 hours');
  });

  it('renders the notice for the old address', async () => {
    const html = await service.renderPreview('EMAIL_CHANGE_NOTICE');

    expect(html).toContain('jane.new@example.com');
    expect(html).toContain('Nothing changes until the new address is confirmed');
    expect(html).toContain('support@propertydesk.live');
  });

  it.each(['EMAIL_CHANGE_VERIFICATION', 'EMAIL_CHANGE_NOTICE'])(
    'ships html and text variants for %s',
    async (templateType) => {
      const metadata = await service.getTemplateMetadata(templateType);
      expect(metadata.htmlContent.length).toBeGreaterThan(0);
      expect(metadata.textContent.length).toBeGreaterThan(0);
    }
  );
});
