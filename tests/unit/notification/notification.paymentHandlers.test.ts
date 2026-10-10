import ejs from 'ejs';
import path from 'path';
import { Types } from 'mongoose';
import { MailType } from '@interfaces/utils.interface';
import { ROLES } from '@shared/constants/roles.constants';
import { RecipientTypeEnum } from '@interfaces/notification.interface';
import { MAIL_POLICY } from '@services/notification/notificationPolicy';
import { resolveTenantRecipient } from '@services/notification/notification.helpers';
import {
  handleMaintenanceChargeSkipped,
  handleMaintenanceChargeCreated,
} from '@services/notification/notification.maintenance.handlers';
import {
  handlePadPreDebitNotification,
  handlePaymentRetriedWithCard,
  handlePaymentRequestCreated,
  handleDepositRefundFailed,
  handlePadMandateConfirmed,
  handlePadDebitInitiated,
  handlePaymentSucceeded,
  handlePaymentRefunded,
  handlePaymentOverdue,
  handlePaymentFailed,
} from '@services/notification/notification.payment.handlers';

const CUID = 'CLIENT001';
const TEMPLATES_DIR = path.join(__dirname, '../../../app/mailer/templates');

const tenantUserId = new Types.ObjectId();
const tenantProfileId = new Types.ObjectId();
const managerId = new Types.ObjectId();
const adminId = new Types.ObjectId();
const propertyId = new Types.ObjectId();
const leaseId = new Types.ObjectId();

const tenantUser = {
  _id: tenantUserId,
  uid: 'TENANT-UID',
  email: 'tenant@example.com',
  profile: { personalInfo: { firstName: 'Jane' } },
};
const managerUser = { _id: managerId, email: 'manager@example.com' };
const adminUser = { _id: adminId, email: 'owner@example.com' };
const tenantProfile = {
  _id: tenantProfileId,
  user: tenantUserId,
  personalInfo: { firstName: 'Jane' },
};

interface CtxOptions {
  payment?: Record<string, any> | null;
  lease?: Record<string, any> | null;
  clientDefaultCurrency?: string;
}

const buildCtx = (opts: CtxOptions = {}) => {
  const users = [tenantUser, managerUser, adminUser];
  return {
    createNotification: jest.fn().mockResolvedValue({ success: true, data: { nuid: 'n1' } }),
    emailQueue: { addToEmailQueue: jest.fn() },
    sseService: { sendToUser: jest.fn() },
    userDAO: {
      findFirst: jest.fn(
        async ({ _id }: { _id: Types.ObjectId }) => users.find((u) => u._id.equals(_id)) ?? null
      ),
    },
    profileDAO: {
      findFirst: jest.fn(async ({ _id }: { _id: Types.ObjectId }) =>
        tenantProfile._id.equals(_id) ? tenantProfile : null
      ),
    },
    paymentDAO: { findFirst: jest.fn().mockResolvedValue(opts.payment ?? null) },
    leaseDAO: { findFirst: jest.fn().mockResolvedValue(opts.lease ?? null) },
    propertyDAO: { findFirst: jest.fn().mockResolvedValue({ managedBy: managerId }) },
    clientDAO: {
      getClientByCuid: jest.fn().mockResolvedValue({
        cuid: CUID,
        accountAdmin: adminId,
        displayName: 'Maple Ridge',
        settings: { defaultCurrency: opts.clientDefaultCurrency },
        companyProfile: {
          legalEntityName: 'Maple Ridge Properties Inc.',
          companyAddress: '456 Oak Avenue, Toronto, ON',
          companyPhone: '(416) 555-0123',
          companyEmail: 'billing@mapleridge.example',
        },
      }),
    },
    log: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  } as any;
};

const emailCall = (ctx: any, jobName: string) =>
  ctx.emailQueue.addToEmailQueue.mock.calls.find(([name]: [string]) => name === jobName)?.[1];

const individualNotices = (ctx: any) =>
  ctx.createNotification.mock.calls
    .map(([, , data]: any[]) => data)
    .filter((data: any) => data.recipientType === RecipientTypeEnum.INDIVIDUAL);

const announcements = (ctx: any) =>
  ctx.createNotification.mock.calls
    .map(([, , data]: any[]) => data)
    .filter((data: any) => data.recipientType === RecipientTypeEnum.ANNOUNCEMENT);

/** Renders html + text variants exactly like MailService.buildTemplate does. */
const renderTemplate = async (subdir: string, filename: string, data: Record<string, any>) => {
  const locals = { ...data, ROLES, year: 2026 };
  const html = await ejs.renderFile(path.join(TEMPLATES_DIR, subdir, `${filename}.ejs`), locals);
  const text = await ejs.renderFile(
    path.join(TEMPLATES_DIR, subdir, `${filename}.text.ejs`),
    locals
  );
  return { html, text };
};

describe('resolveTenantRecipient', () => {
  it('resolves a User _id', async () => {
    const ctx = buildCtx();
    const tenant = await resolveTenantRecipient(ctx, tenantUserId.toString());
    expect(tenant).toEqual(
      expect.objectContaining({
        userId: tenantUserId.toString(),
        email: 'tenant@example.com',
        firstName: 'Jane',
      })
    );
    expect(ctx.profileDAO.findFirst).not.toHaveBeenCalled();
  });

  it('resolves a Profile _id to the profile owner', async () => {
    const ctx = buildCtx();
    const tenant = await resolveTenantRecipient(ctx, tenantProfileId.toString());
    expect(tenant?.userId).toBe(tenantUserId.toString());
    expect(tenant?.email).toBe('tenant@example.com');
  });

  it('returns null for an id that is neither', async () => {
    const ctx = buildCtx();
    expect(await resolveTenantRecipient(ctx, new Types.ObjectId().toString())).toBeNull();
    expect(await resolveTenantRecipient(ctx, 'not-an-id')).toBeNull();
    expect(await resolveTenantRecipient(ctx, undefined)).toBeNull();
  });
});

describe('handlePaymentFailed', () => {
  it.each([
    ['User _id', tenantUserId],
    ['Profile _id', tenantProfileId],
  ])('notifies the tenant USER when tenantId is a %s', async (_label, id) => {
    const ctx = buildCtx();
    await handlePaymentFailed(ctx, {
      cuid: CUID,
      pytuid: 'PYT1',
      invoiceId: 'in_1',
      amount: 150000,
      currency: 'cad',
      failureReason: 'Insufficient funds',
      tenantId: id.toString(),
    });

    const [tenantNotice] = individualNotices(ctx);
    expect(tenantNotice.recipient).toBe(tenantUserId.toString());
    expect(tenantNotice.message).toContain('Insufficient funds');
    expect(tenantNotice.message).toContain('CA$1,500.00');

    const email = emailCall(ctx, 'paymentFailed');
    expect(email.to).toBe('tenant@example.com');
    expect(email.data).toEqual(
      expect.objectContaining({ amount: 'CA$1,500.00', failureReason: 'Insufficient funds' })
    );
  });

  it('falls back to the payment record currency when the payload has none', async () => {
    const ctx = buildCtx({ payment: { currency: 'NGN' } });
    await handlePaymentFailed(ctx, {
      cuid: CUID,
      pytuid: 'PYT1',
      invoiceId: 'in_1',
      amount: 150000,
      tenantId: tenantUserId.toString(),
    });
    expect(emailCall(ctx, 'paymentFailed').data.amount).toMatch(/^NGN\s1,500\.00$/);
  });

  it('falls back to the client default currency when the payment has none', async () => {
    const ctx = buildCtx({ payment: null, clientDefaultCurrency: 'cad' });
    await handlePaymentFailed(ctx, {
      cuid: CUID,
      pytuid: 'PYT1',
      invoiceId: 'in_1',
      amount: 150000,
      tenantId: tenantUserId.toString(),
    });
    expect(emailCall(ctx, 'paymentFailed').data.amount).toBe('CA$1,500.00');
  });

  it('only notifies managers when the tenant cannot be resolved', async () => {
    const ctx = buildCtx();
    await handlePaymentFailed(ctx, {
      cuid: CUID,
      pytuid: 'PYT1',
      invoiceId: 'in_1',
      amount: 150000,
      tenantId: new Types.ObjectId().toString(),
    });
    expect(ctx.createNotification).toHaveBeenCalledTimes(1);
    expect(ctx.emailQueue.addToEmailQueue).not.toHaveBeenCalled();
  });

  it('renders the failure reason in the email', async () => {
    const ctx = buildCtx();
    await handlePaymentFailed(ctx, {
      cuid: CUID,
      pytuid: 'PYT1',
      invoiceId: 'in_1',
      amount: 150000,
      currency: 'CAD',
      failureReason: 'Account closed',
      tenantId: tenantUserId.toString(),
    });
    const { html, text } = await renderTemplate(
      'payment',
      'payment-failed',
      emailCall(ctx, 'paymentFailed').data
    );
    expect(html).toContain('Account closed');
    expect(text).toContain('Reason: Account closed');
  });
});

describe('handlePaymentSucceeded', () => {
  it('emails a receipt to the profile owner with currency and a consistent date', async () => {
    const ctx = buildCtx();
    await handlePaymentSucceeded(ctx, {
      cuid: CUID,
      pytuid: 'PYT1',
      invoiceId: 'in_1',
      amount: 210000,
      currency: 'CAD',
      paidAt: new Date(2026, 7, 1),
      paymentType: 'late_fee',
      tenantId: tenantProfileId.toString(),
    });
    const email = emailCall(ctx, 'paymentReceipt');
    expect(email.to).toBe('tenant@example.com');
    expect(email.data).toEqual(
      expect.objectContaining({
        amount: 'CA$2,100.00',
        paidAt: 'Aug 1, 2026',
        paymentType: 'Late fee',
      })
    );
  });
});

describe('handlePaymentOverdue', () => {
  it.each([
    ['maintenance', 'Maintenance Payment Overdue', 'maintenance payment'],
    ['late_fee', 'Late fee Payment Overdue', 'late fee payment'],
    ['rent', 'Rent Payment Overdue', 'rent payment'],
  ])('uses the payment type (%s) in the wording', async (paymentType, title, phrase) => {
    const ctx = buildCtx();
    await handlePaymentOverdue(ctx, {
      cuid: CUID,
      pytuid: 'PYT1',
      amount: 5000,
      currency: 'CAD',
      dueDate: new Date(2026, 4, 1),
      paymentType,
      tenantId: tenantProfileId.toString(),
    });

    const [pmNotice] = announcements(ctx);
    const [tenantNotice] = individualNotices(ctx);
    expect(pmNotice.title).toBe(title);
    expect(tenantNotice.title).toBe(title);
    expect(tenantNotice.message).toContain(phrase);
    expect(tenantNotice.message).toContain('May 1, 2026');
    expect(tenantNotice.recipient).toBe(tenantUserId.toString());
  });
});

describe('handlePaymentRequestCreated', () => {
  const basePayload = {
    cuid: CUID,
    pytuid: 'PYT1',
    amountInCents: 210000,
    dueDate: new Date(2026, 7, 1),
    tenantUserId: tenantUserId.toString(),
  };

  it('promises an automatic charge only for auto-debit leases', async () => {
    const ctx = buildCtx();
    await handlePaymentRequestCreated(ctx, {
      ...basePayload,
      currency: 'CAD',
      paymentType: 'rent',
      acceptedPaymentMethod: 'auto-debit',
    });
    const [notice] = individualNotices(ctx);
    expect(notice.message).toContain('charged automatically');
    expect(notice.message).toContain('CA$2,100.00');
  });

  it('asks cash / cheque / e-transfer tenants to pay by the due date', async () => {
    const ctx = buildCtx();
    await handlePaymentRequestCreated(ctx, {
      ...basePayload,
      currency: 'CAD',
      paymentType: 'rent',
      acceptedPaymentMethod: 'e-transfer',
    });
    const [notice] = individualNotices(ctx);
    expect(notice.message).not.toContain('automatically');
    expect(notice.message).toContain('Please pay by the due date');
    expect(notice.message).toContain('Aug 1, 2026');
  });

  it('looks up the lease payment method when the payload lacks it', async () => {
    const ctx = buildCtx({
      payment: { currency: 'CAD', paymentType: 'maintenance', lease: leaseId },
      lease: { fees: { acceptedPaymentMethod: 'auto-debit' } },
    });
    await handlePaymentRequestCreated(ctx, basePayload);
    const [notice] = individualNotices(ctx);
    expect(ctx.leaseDAO.findFirst).toHaveBeenCalled();
    expect(notice.message).toContain('maintenance payment');
    expect(notice.message).toContain('charged automatically');
  });

  it('uses the manual wording when the lease is unknown', async () => {
    const ctx = buildCtx({ payment: { currency: 'CAD' } });
    await handlePaymentRequestCreated(ctx, basePayload);
    expect(individualNotices(ctx)[0].message).toContain('Please pay by the due date');
  });
});

describe('handlePadPreDebitNotification', () => {
  it('sends a required advance notice with date, amount, reference, account and payee contact', async () => {
    const ctx = buildCtx();
    await handlePadPreDebitNotification(ctx, {
      cuid: CUID,
      pytuid: 'PYT1',
      tenantId: tenantProfileId.toString(),
      amount: 210000,
      currency: 'cad',
      debitDate: new Date(2026, 7, 11),
      paymentType: 'rent',
      accountLast4: '6789',
      mandateReference: 'mandate_1',
    });

    const email = emailCall(ctx, 'padPreDebitNotification');
    expect(email.to).toBe('tenant@example.com');
    expect(email.emailType).toBe(MailType.PAD_PRE_DEBIT_NOTIFICATION);
    expect(email.data).toEqual(
      expect.objectContaining({
        amount: 'CA$2,100.00',
        currency: 'CAD',
        debitDate: 'Aug 11, 2026',
        reference: 'PYT1',
        accountLast4: '6789',
        paymentType: 'Rent',
        payeeName: 'Maple Ridge Properties Inc.',
        payeePhone: '(416) 555-0123',
        payeeEmail: 'billing@mapleridge.example',
      })
    );
    expect(MAIL_POLICY[MailType.PAD_PRE_DEBIT_NOTIFICATION].required).toBe(true);

    const { html, text } = await renderTemplate(
      'payment',
      'pad-pre-debit-notification',
      email.data
    );
    expect(html).toContain('Aug 11, 2026');
    expect(html).toContain('ending in 6789');
    expect(text).toContain('Reference: PYT1');
    expect(text).toContain('www.payments.ca');
  });
});

describe('handlePadDebitInitiated', () => {
  it('tells the tenant the debit is processing', async () => {
    const ctx = buildCtx();
    await handlePadDebitInitiated(ctx, {
      cuid: CUID,
      pytuid: 'PYT1',
      tenantId: tenantProfileId.toString(),
      amount: 210000,
      currency: 'CAD',
    });
    const email = emailCall(ctx, 'padDebitInitiated');
    expect(email.emailType).toBe(MailType.PAD_DEBIT_INITIATED);
    expect(email.data.amount).toBe('CA$2,100.00');
    expect(MAIL_POLICY[MailType.PAD_DEBIT_INITIATED].required).toBe(true);

    const { html } = await renderTemplate('payment', 'pad-debit-initiated', email.data);
    expect(html).toContain('processing');
  });
});

describe('handlePadMandateConfirmed', () => {
  it('includes Rule H1 content: mandate reference, payee contact, notice period', async () => {
    const ctx = buildCtx();
    await handlePadMandateConfirmed(ctx, {
      cuid: CUID,
      tenantId: tenantProfileId.toString(),
      mandateId: 'mandate_1',
      pmAccountId: 'acct_1',
      accountLast4: '6789',
    });
    const email = emailCall(ctx, 'padMandateConfirmation');
    expect(email.to).toBe('tenant@example.com');
    expect(email.data).toEqual(
      expect.objectContaining({
        mandateReference: 'mandate_1',
        accountLast4: '6789',
        payeeAddress: '456 Oak Avenue, Toronto, ON',
        noticeDays: expect.any(Number),
      })
    );

    const { html, text } = await renderTemplate('payment', 'pad-mandate-confirmation', email.data);
    expect(html).toContain('right to receive reimbursement');
    expect(html).toContain('mandate_1');
    expect(text).toContain('www.payments.ca');
    expect(text).toContain('(416) 555-0123');
  });
});

describe('handlePaymentRetriedWithCard', () => {
  it('tells the tenant (email + in-app) and informs managers', async () => {
    const ctx = buildCtx();
    await handlePaymentRetriedWithCard(ctx, {
      cuid: CUID,
      pytuid: 'PYT1',
      tenantId: tenantProfileId.toString(),
      amount: 210000,
      currency: 'CAD',
      cardLast4: '4242',
      failureReason: 'Insufficient funds',
    });

    const [tenantNotice] = individualNotices(ctx);
    expect(tenantNotice.recipient).toBe(tenantUserId.toString());
    expect(tenantNotice.message).toContain('card ending in 4242');
    expect(announcements(ctx)[0].targetRoles).toEqual(expect.arrayContaining([ROLES.MANAGER]));

    const email = emailCall(ctx, 'paymentRetriedWithCard');
    expect(email.emailType).toBe(MailType.PAYMENT_RETRIED_WITH_CARD);
    const { html } = await renderTemplate('payment', 'payment-retried-with-card', email.data);
    expect(html).toContain('ending in 4242');
    expect(html).toContain('CA$2,100.00');
  });
});

describe('handlePaymentRefunded', () => {
  it('emails the tenant the amount, partial flag and reason', async () => {
    const ctx = buildCtx();
    await handlePaymentRefunded(ctx, {
      cuid: CUID,
      pytuid: 'PYT1',
      chargeId: 'ch_1',
      refundAmount: 50000,
      amount: 50000,
      totalRefunded: 50000,
      currency: 'CAD',
      isPartial: true,
      reason: 'Overpayment',
      tenantId: tenantProfileId.toString(),
    });

    expect(announcements(ctx)[0].targetRoles).toEqual([ROLES.SUPER_ADMIN]);
    expect(individualNotices(ctx)[0].recipient).toBe(tenantUserId.toString());

    const email = emailCall(ctx, 'paymentRefunded');
    expect(email.emailType).toBe(MailType.PAYMENT_REFUNDED);
    expect(email.data).toEqual(
      expect.objectContaining({ amount: 'CA$500.00', isPartial: true, reason: 'Overpayment' })
    );
    const { text } = await renderTemplate('payment', 'payment-refunded', email.data);
    expect(text).toContain('partial refund of CA$500.00');
    expect(text).toContain('Reason: Overpayment');
  });

  it('finds the tenant from the payment record when the payload has no tenantId', async () => {
    const ctx = buildCtx({ payment: { currency: 'CAD', tenant: tenantProfileId } });
    await handlePaymentRefunded(ctx, {
      cuid: CUID,
      pytuid: 'PYT1',
      chargeId: 'ch_1',
      refundAmount: 50000,
    });
    expect(emailCall(ctx, 'paymentRefunded').to).toBe('tenant@example.com');
  });
});

describe('handleDepositRefundFailed', () => {
  it("notifies managers in-app and emails the property's manager", async () => {
    const ctx = buildCtx({ lease: { property: { id: propertyId } } });
    await handleDepositRefundFailed(ctx, {
      cuid: CUID,
      pytuid: 'PYT-DEP',
      leaseId: leaseId.toString(),
      amount: 150000,
      currency: 'CAD',
      reason: 'Bank account closed',
    });

    const [notice] = announcements(ctx);
    expect(notice.required).toBe(true);
    expect(notice.message).toContain('Bank account closed');

    const email = emailCall(ctx, 'depositRefundFailed');
    expect(email.to).toBe('manager@example.com');
    expect(email.emailType).toBe(MailType.DEPOSIT_REFUND_FAILED);
    const { html } = await renderTemplate('payment', 'deposit-refund-failed', email.data);
    expect(html).toContain('CA$1,500.00');
  });

  it('falls back to the account admin when the property has no manager', async () => {
    const ctx = buildCtx({ lease: null });
    await handleDepositRefundFailed(ctx, {
      cuid: CUID,
      pytuid: 'PYT-DEP',
      leaseId: leaseId.toString(),
      amount: 150000,
      currency: 'CAD',
      reason: 'x',
    });
    expect(emailCall(ctx, 'depositRefundFailed').to).toBe('owner@example.com');
  });
});

describe('handleMaintenanceChargeCreated', () => {
  const payload = {
    cuid: CUID,
    mruid: 'MR1',
    pytuid: 'PYT1',
    title: 'Fix sink',
    amountInCents: 25000,
    currency: 'CAD',
    dueDate: new Date(2026, 7, 15),
    tenantId: tenantProfileId.toString(),
  };

  it('addresses a Profile _id tenant by User _id and uses manual wording for non-auto-debit', async () => {
    const ctx = buildCtx({
      payment: { lease: leaseId },
      lease: { fees: { acceptedPaymentMethod: 'cash' } },
    });
    await handleMaintenanceChargeCreated(ctx, payload);

    const [notice] = individualNotices(ctx);
    expect(notice.recipient).toBe(tenantUserId.toString());
    expect(notice.message).toContain('Please pay by Aug 15, 2026');
    expect(notice.message).toContain('CA$250.00');

    const email = emailCall(ctx, 'maintenanceChargeCreated');
    expect(email.to).toBe('tenant@example.com');
    const { html, text } = await renderTemplate(
      'maintenance',
      'maintenance-charge-created',
      email.data
    );
    expect(html).not.toContain('automatically');
    expect(html).toContain('CA$250.00');
    expect(text).toContain('Please pay by the due date');
  });

  it('mentions the automatic charge for auto-debit leases', async () => {
    const ctx = buildCtx({
      payment: { lease: leaseId },
      lease: { fees: { acceptedPaymentMethod: 'auto-debit' } },
    });
    await handleMaintenanceChargeCreated(ctx, payload);
    expect(individualNotices(ctx)[0].message).toContain('auto-debit');
    const { text } = await renderTemplate(
      'maintenance',
      'maintenance-charge-created',
      emailCall(ctx, 'maintenanceChargeCreated').data
    );
    expect(text).toContain('charged to your payment method on file');
  });
});

describe('payment request email template', () => {
  const data = {
    tenantName: 'Jane',
    propertyAddress: '1 Main St',
    unitNumber: '',
    paymentType: 'Rent',
    amountDue: 'CA$2,100.00',
    dueDate: new Date(2026, 7, 1).toISOString(),
    description: '',
    paymentUrl: '',
  };

  it('does not promise an automatic charge unless isAutoDebit is set', async () => {
    const manual = await renderTemplate('payment', 'payment-request', data);
    expect(manual.html).not.toContain('charged automatically');
    expect(manual.text).toContain('Please pay by Aug 1, 2026');

    const auto = await renderTemplate('payment', 'payment-request', { ...data, isAutoDebit: true });
    expect(auto.text).toContain('charged automatically');
  });
});

describe('MAIL_POLICY for payment notices', () => {
  it.each([
    MailType.PAD_DEBIT_INITIATED,
    MailType.PAYMENT_RETRIED_WITH_CARD,
    MailType.PAYMENT_REFUNDED,
    MailType.DEPOSIT_REFUND_FAILED,
    MailType.INSPECTION_APPROVED,
  ])('%s is required', (mailType) => {
    expect(MAIL_POLICY[mailType].required).toBe(true);
  });
});

describe('handleMaintenanceChargeSkipped', () => {
  const approverId = new Types.ObjectId().toString();
  const payload = {
    cuid: CUID,
    mruid: 'MR1',
    reason: 'tenant_profile_not_found' as const,
    notifyUserId: approverId,
    amountInCents: 25000,
    currency: 'CAD',
    title: 'Fix sink',
  };

  const ctxWithRequest = (request: any) => {
    const ctx = buildCtx();
    ctx.maintenanceRequestDAO = { getByMruid: jest.fn().mockResolvedValue(request) };
    return ctx;
  };

  it("tells the approving PM and the property's manager to bill manually", async () => {
    const ctx = ctxWithRequest({ propertyId });
    await handleMaintenanceChargeSkipped(ctx, payload);

    const notices = individualNotices(ctx);
    expect(notices.map((n: any) => n.recipient)).toEqual([approverId, managerId.toString()]);
    expect(notices[0].required).toBe(true);
    expect(notices[0].message).toContain('CA$250.00');
    expect(notices[0].message).toContain("tenant's profile could not be found");
    expect(notices[0].message).toContain('bill the tenant manually');
  });

  it('notifies once when the approver is the property manager', async () => {
    const ctx = ctxWithRequest({ propertyId });
    await handleMaintenanceChargeSkipped(ctx, {
      ...payload,
      reason: 'no_tenant',
      notifyUserId: managerId.toString(),
    });
    const notices = individualNotices(ctx);
    expect(notices).toHaveLength(1);
    expect(notices[0].message).toContain('the request has no tenant');
  });

  it('falls back to a manager announcement when nobody can be identified', async () => {
    const ctx = ctxWithRequest(null);
    await handleMaintenanceChargeSkipped(ctx, { ...payload, notifyUserId: undefined });
    expect(individualNotices(ctx)).toHaveLength(0);
    const [notice] = announcements(ctx);
    expect(notice.targetRoles).toEqual(expect.arrayContaining([ROLES.MANAGER]));
    expect(notice.required).toBe(true);
  });
});
