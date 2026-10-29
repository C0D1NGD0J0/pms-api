import { EmailTemplateService } from '@services/emailTemplate/emailTemplate.service';

/**
 * Compliance (Group B): verifies the shared email footer no longer has a dead
 * privacy link and that tenant-facing lease / invitation emails carry the
 * neutral non-discrimination notice.
 */
describe('EmailTemplateService — legal footer & housing notice', () => {
  const service = new EmailTemplateService();
  const HOUSING_LINE = 'equal and fair access to housing';

  it('renders the shared footer without a dead "#" link', async () => {
    const html = await service.renderPreview('LEASE_ACTIVATED');

    expect(html).not.toContain('href="#"');
    expect(html).toContain('propertydesk.live/terms-of-service.html');
    expect(html).toContain('propertydesk.live/privacy-policy.html');
  });

  it('includes the non-discrimination notice in tenant lease emails', async () => {
    for (const key of [
      'LEASE_ACTIVATED',
      'LEASE_TERMINATED',
      'LEASE_ENDING_SOON',
      'LEASE_EXPIRED',
    ]) {
      const html = await service.renderPreview(key);
      expect(html).toContain(HOUSING_LINE);
    }
  });

  it('includes the notice in tenant invitations but not staff/vendor ones', async () => {
    const tenant = await service.renderPreview('INVITATION_TENANT');
    const staff = await service.renderPreview('INVITATION_STAFF');
    const vendor = await service.renderPreview('INVITATION_VENDOR');

    expect(tenant).toContain(HOUSING_LINE);
    expect(staff).not.toContain(HOUSING_LINE);
    expect(vendor).not.toContain(HOUSING_LINE);
  });
});
