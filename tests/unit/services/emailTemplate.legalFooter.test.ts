import { EmailTemplateService } from '@services/emailTemplate/emailTemplate.service';
import { getMockTemplateData } from '@services/emailTemplate/mockTemplateData';

/**
 * Compliance (Group B): verifies the shared email footer no longer has a dead
 * privacy link, and that the neutral non-discrimination notice only appears on
 * tenant-facing emails for US properties (US Fair Housing concept).
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

  it('shows the notice on tenant lease emails for US properties', async () => {
    for (const key of [
      'LEASE_ACTIVATED',
      'LEASE_TERMINATED',
      'LEASE_ENDING_SOON',
      'LEASE_EXPIRED',
    ]) {
      // Mock data has isUSProperty: true
      const html = await service.renderPreview(key);
      expect(html).toContain(HOUSING_LINE);
    }
  });

  it('hides the notice on tenant lease emails for non-US properties', async () => {
    const data = { ...getMockTemplateData('LEASE_ACTIVATED'), isUSProperty: false };
    const html = await service.renderTemplate('LEASE_ACTIVATED', data);
    expect(html).not.toContain(HOUSING_LINE);
  });

  it('gates tenant invitations on US property + tenant role', async () => {
    const base = getMockTemplateData('INVITATION_TENANT');

    const usTenant = await service.renderTemplate('INVITATION_TENANT', {
      ...base,
      isUSProperty: true,
    });
    expect(usTenant).toContain(HOUSING_LINE);

    const nonUsTenant = await service.renderTemplate('INVITATION_TENANT', {
      ...base,
      isUSProperty: false,
    });
    expect(nonUsTenant).not.toContain(HOUSING_LINE);

    // Staff invites never show it, even for a US property
    const staff = await service.renderTemplate('INVITATION_STAFF', {
      ...getMockTemplateData('INVITATION_STAFF'),
      isUSProperty: true,
    });
    expect(staff).not.toContain(HOUSING_LINE);
  });
});
