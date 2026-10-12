import { EmailTemplateService } from '@services/emailTemplate/emailTemplate.service';

describe('EmailTemplateService — template registry', () => {
  const service = new EmailTemplateService();

  const variantExpectations: Record<string, string> = {
    INVITATION_STAFF: 'as a team member',
    INVITATION_TENANT: 'Activate My Account',
    INVITATION_VENDOR: 'vendor network',
    COMPANY_CLOSURE_OWNER: 'Closure Summary',
    COMPANY_CLOSURE_STAFF: 'read-only',
    COMPANY_CLOSURE_TENANT: 'tenant portal',
    COMPANY_CLOSURE_VENDOR: 'pending payouts',
    INSPECTION_SCHEDULED: 'You are responsible for conducting this inspection',
    INSPECTION_SUBMITTED: 'available for your review',
    INSPECTION_APPROVED: 'A refund of',
    INSPECTION_REJECTED: 'requires revision before it can be finalized',
    INSPECTION_CANCELLED: 'has been cancelled',
    MAINTENANCE_REQUEST_CREATED: 'received your maintenance request',
    MAINTENANCE_REQUEST_ASSIGNED: 'accept or decline within 24 hours',
    MAINTENANCE_REQUEST_ACCEPTED: 'a vendor has <strong>accepted</strong>',
    MAINTENANCE_REQUEST_DECLINED: 'has declined the maintenance request',
    MAINTENANCE_REQUEST_COMPLETED: 'has been <strong>completed</strong>',
    MAINTENANCE_INVOICE_SUBMITTED: 'has submitted an invoice',
    MAINTENANCE_INVOICE_APPROVED: 'Payment will be processed',
    MAINTENANCE_INVOICE_REJECTED: 'submit a corrected invoice',
    MAINTENANCE_WORK_ORDER_SUBMITTED: 'Your approval is required',
    MAINTENANCE_WORK_ORDER_SUBMITTED_TENANT: 'no action is required from you',
    MAINTENANCE_WORK_ORDER_APPROVED: 'You may now proceed with the work',
    MAINTENANCE_WORK_ORDER_REJECTED: 'Please review the feedback below and resubmit',
  };

  let templateTypes: string[] = [];

  beforeAll(async () => {
    templateTypes = (await service.getTemplateList()).map((t) => t.templateType);
  });

  it('lists every template', () => {
    expect(templateTypes.length).toBeGreaterThan(0);
    expect(templateTypes).toEqual(expect.arrayContaining(Object.keys(variantExpectations)));
  });

  it('points every registry entry at an existing html template file', async () => {
    const missing: string[] = [];
    for (const templateType of templateTypes) {
      const metadata = await service.getTemplateMetadata(templateType).catch(() => null);
      if (!metadata || !metadata.htmlContent) missing.push(templateType);
    }
    expect(missing).toEqual([]);
  });

  it('renders a preview for every registry entry', async () => {
    const failures: string[] = [];
    for (const templateType of templateTypes) {
      try {
        const html = await service.renderPreview(templateType);
        if (!html.includes('<html')) failures.push(`${templateType}: missing layout`);
      } catch (error) {
        failures.push(`${templateType}: ${(error as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it.each(Object.entries(variantExpectations))(
    'renders the %s variant of its combined template',
    async (templateType, expectedSnippet) => {
      const html = await service.renderPreview(templateType);
      expect(html).toContain(expectedSnippet);
    }
  );

  it('keeps the variant flag even when caller variables try to override it', async () => {
    const html = await service.renderTemplate('INSPECTION_CANCELLED', {
      currentuser: { firstName: 'Sam' },
      iuid: 'INSP-1',
      _status: 'scheduled',
    });
    expect(html).toContain('has been cancelled');
  });
});
