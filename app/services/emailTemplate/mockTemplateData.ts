/**
 * Mock data factories for email template previews.
 * Each MailType maps to realistic sample data matching the EJS variables
 * used by its corresponding template file.
 */
export function getMockTemplateData(templateType: string): Record<string, any> {
  const defaults = {
    appName: 'PropertyDesk',
    year: new Date().getFullYear(),
    frontendUrl: 'http://localhost:3000',
  };

  const mocks: Record<string, Record<string, any>> = {
    // ── Account ───────────────────────────────────────────────────
    ACCOUNT_ACTIVATION: {
      fullname: 'Jane Doe',
      activationUrl: 'http://localhost:3000/activate?t=sample-token-abc123',
    },
    ACCOUNT_UPDATE: {
      fullname: 'Jane Doe',
      updatedAt: 'July 10, 2026 at 3:45 PM',
    },
    ACCOUNT_DISCONNECTED: {
      fullname: 'Jane Doe',
      companyName: 'Maple Ridge Properties',
      disconnectedAt: 'July 10, 2026',
      roles: 'Tenant',
    },
    USER_CREATED: {
      firstName: 'Jane',
      companyName: 'Maple Ridge Properties',
      role: 'staff',
      department: 'maintenance',
      jobTitle: 'Maintenance Coordinator',
      customMessage: 'Welcome to the team! Your account has been set up.',
      email: 'jane.doe@example.com',
      temporaryPassword: 'TempPass!2026',
      loginUrl: 'http://localhost:3000/login',
    },
    FORGOT_PASSWORD: {
      fullname: 'Jane Doe',
      resetUrl: 'http://localhost:3000/reset-password?t=sample-token-xyz789',
    },
    PASSWORD_RESET: {
      fullname: 'Jane Doe',
      resetUrl: 'http://localhost:3000/reset-password?t=sample-token-xyz789',
    },

    // ── Invitations ──────────────────────────────────────────────
    INVITATION: {
      inviteeName: 'Alex Johnson',
      inviterName: 'Sarah Chen',
      companyName: 'Maple Ridge Properties',
      role: 'staff',
      customMessage: 'We are excited to have you join our team!',
      expiresAt: 'July 20, 2026',
      invitationUrl: 'http://localhost:3000/invite/accept?t=sample-invite-token',
    },
    INVITATION_STAFF: {
      inviteeName: 'Alex Johnson',
      inviterName: 'Sarah Chen',
      companyName: 'Maple Ridge Properties',
      customMessage: 'We are excited to have you join our team!',
      expiresAt: 'July 20, 2026',
      invitationUrl: 'http://localhost:3000/invite/accept?t=sample-invite-token',
    },
    INVITATION_TENANT: {
      inviteeName: 'John Smith',
      inviterName: 'Sarah Chen',
      companyName: 'Maple Ridge Properties',
      customMessage: 'Welcome to your new home!',
      expiresAt: 'July 20, 2026',
      invitationUrl: 'http://localhost:3000/invite/accept?t=sample-invite-token',
    },
    INVITATION_VENDOR: {
      inviteeName: 'Mike Thompson',
      inviterName: 'Sarah Chen',
      companyName: 'Maple Ridge Properties',
      customMessage: 'We would love to work with you on our properties.',
      expiresAt: 'July 20, 2026',
      invitationUrl: 'http://localhost:3000/invite/accept?t=sample-invite-token',
    },
    INVITATION_REMINDER: {
      inviteeName: 'Alex Johnson',
      resenderName: 'Sarah Chen',
      companyName: 'Maple Ridge Properties',
      role: 'staff',
      customMessage: 'Just a reminder — your invitation is still active.',
      expiresAt: 'July 20, 2026',
      invitationUrl: 'http://localhost:3000/invite/accept?t=sample-invite-token',
    },

    // ── Lease ────────────────────────────────────────────────────
    LEASE_ACTIVATED: {
      tenantName: 'John Smith',
      propertyAddress: '456 Oak Avenue, Toronto, ON M5V 2T6',
      leaseNumber: 'LS-2026-0042',
      unitNumber: '4B',
      startDate: 'August 1, 2026',
      endDate: 'July 31, 2027',
      rentAmount: '$2,100.00',
      leaseUrl: 'http://localhost:3000/leases/LS-2026-0042',
      firstPaymentDate: 'August 1, 2026',
      securityDepositInfo: '$2,100.00 security deposit collected',
      propertyManagerEmail: 'manager@mapleridge.com',
      propertyManagerPhone: '(416) 555-0123',
    },
    LEASE_ADMIN_UPDATED: {
      tenantName: 'John Smith',
      propertyAddress: '456 Oak Avenue, Toronto, ON M5V 2T6',
      leaseNumber: 'LS-2026-0042',
      updatedBy: 'Sarah Chen',
      leaseUrl: 'http://localhost:3000/leases/LS-2026-0042',
    },
    LEASE_ENDING_SOON: {
      notificationStage: '60-day',
      daysRemaining: 60,
      tenantName: 'John Smith',
      propertyAddress: '456 Oak Avenue, Toronto, ON M5V 2T6',
      isAutoRenewing: false,
      renewalTermMonths: 12,
      leaseNumber: 'LS-2026-0042',
      unitNumber: '4B',
      endDate: 'July 31, 2027',
      renewalTerms: 'Same terms as current lease',
      noticePeriod: '60 days',
      noticeDeadline: 'June 1, 2027',
      renewalUrl: 'http://localhost:3000/leases/LS-2026-0042/renew',
      monthToMonthAvailable: true,
      monthToMonthTerms: 'Month-to-month at $2,200/mo',
      responseDeadline: 'June 15, 2027',
      propertyManagerEmail: 'manager@mapleridge.com',
      propertyManagerPhone: '(416) 555-0123',
      propertyManagerName: 'Sarah Chen',
      officeHours: 'Mon-Fri 9AM-5PM',
    },
    LEASE_TERMINATED: {
      tenantName: 'John Smith',
      propertyAddress: '456 Oak Avenue, Toronto, ON M5V 2T6',
      leaseNumber: 'LS-2026-0042',
      unitNumber: '4B',
      terminationDate: 'September 30, 2026',
      moveOutDate: 'September 30, 2026',
      terminationReason: 'Mutual agreement between landlord and tenant',
      leaseUrl: 'http://localhost:3000/leases/LS-2026-0042',
      notes: 'Please schedule your move-out inspection at least 48 hours in advance.',
      propertyManagerEmail: 'manager@mapleridge.com',
      propertyManagerPhone: '(416) 555-0123',
    },
    LEASE_PAYMENT_REMINDER: {
      tenantName: 'John Smith',
      propertyAddress: '456 Oak Avenue, Toronto, ON M5V 2T6',
      unitNumber: '4B',
      amountDue: '$2,100.00',
      dueDate: 'August 1, 2026',
      daysUntilDue: 5,
      paymentUrl: 'http://localhost:3000/payments/pay',
      paymentMethods: ['Online Payment', 'Pre-Authorized Debit'],
      mailAddress: '456 Oak Avenue, Toronto, ON M5V 2T6',
      bankDetails: 'TD Bank — Transit 12345, Account 7890123',
      lateFeeAmount: '$50.00',
      lateFeeDate: 'August 5, 2026',
      currentBalance: '$0.00',
      propertyManagerEmail: 'manager@mapleridge.com',
      propertyManagerPhone: '(416) 555-0123',
    },

    // ── Payment ──────────────────────────────────────────────────
    PAYMENT_REQUEST_CREATED: {
      tenantName: 'John Smith',
      propertyAddress: '456 Oak Avenue, Toronto, ON M5V 2T6',
      unitNumber: '4B',
      paymentType: 'Rent',
      amountDue: '$2,100.00',
      dueDate: 'August 1, 2026',
      description: 'Monthly rent payment for August 2026',
      paymentUrl: 'http://localhost:3000/payments/pay',
    },
    PAYMENT_RECEIPT: {
      tenantName: 'John Smith',
      paymentType: 'Rent',
      amount: '$2,100.00',
      paidAt: 'August 1, 2026',
      receiptUrl: 'http://localhost:3000/payments/receipt/pyt_abc123',
    },
    PAYMENT_FAILED: {
      tenantName: 'John Smith',
      amount: '$2,100.00',
      failureReason: 'Insufficient funds in the linked bank account',
      hostedInvoiceUrl: 'http://localhost:3000/payments/retry/pyt_abc123',
    },
    PAD_MANDATE_CONFIRMATION: {
      tenantName: 'John Smith',
      payeeName: 'Maple Ridge Properties Inc.',
      amount: '$2,100.00',
      frequency: 'Monthly',
      debitDay: '1st',
      startDate: 'August 1, 2026',
      cancellationRights:
        'You may cancel this authorization at any time by contacting your property manager.',
    },
    PAD_PRE_DEBIT_NOTIFICATION: {
      tenantName: 'John Smith',
      amount: '$2,100.00',
      currency: 'CAD',
      payeeName: 'Maple Ridge Properties Inc.',
    },

    // ── Maintenance ──────────────────────────────────────────────
    MAINTENANCE_REQUEST_CREATED: {
      currentuser: { firstName: 'John', email: 'john.smith@example.com' },
      request: {
        mruid: 'MR-2026-0815',
        title: 'Leaking kitchen faucet',
        category: 'Plumbing',
        priority: 'high',
        preferredDate: 'July 15, 2026',
        availabilityWindows: 'Weekdays 9AM-5PM',
      },
    },
    MAINTENANCE_REQUEST_ASSIGNED: {
      vendor: { firstName: 'Mike', email: 'mike@plumbpros.com' },
      assignedBy: { firstName: 'Sarah', email: 'sarah@mapleridge.com' },
      request: {
        mruid: 'MR-2026-0815',
        title: 'Leaking kitchen faucet',
        description: 'The kitchen faucet is dripping constantly and needs repair.',
        category: 'Plumbing',
        priority: 'high',
        permissionToEnter: true,
        scheduledDate: 'July 18, 2026',
        estimatedCost: '$250.00',
        preferredDate: 'July 15, 2026',
        availabilityWindows: 'Weekdays 9AM-5PM',
      },
    },
    MAINTENANCE_REQUEST_ACCEPTED: {
      tenant: { firstName: 'John', email: 'john.smith@example.com' },
      request: {
        mruid: 'MR-2026-0815',
        title: 'Leaking kitchen faucet',
        category: 'Plumbing',
        priority: 'high',
        assignedTechnician: { name: 'Mike Thompson', phone: '(416) 555-0456' },
        scheduledDate: 'July 18, 2026',
      },
    },
    MAINTENANCE_REQUEST_DECLINED: {
      request: {
        mruid: 'MR-2026-0815',
        title: 'Leaking kitchen faucet',
        priority: 'high',
      },
      reason: 'Unable to accommodate the requested schedule. Please reassign.',
    },
    MAINTENANCE_REQUEST_COMPLETED: {
      tenant: { firstName: 'John', email: 'john.smith@example.com' },
      request: {
        mruid: 'MR-2026-0815',
        title: 'Leaking kitchen faucet',
        category: 'Plumbing',
        completedAt: 'July 18, 2026',
        completionNotes: 'Replaced faulty washer and tested for leaks. All clear.',
      },
    },
    MAINTENANCE_CHARGE_CREATED: {
      dueDate: 'August 1, 2026',
      mruid: 'MR-2026-0815',
      jobTitle: 'Leaking kitchen faucet — repair',
      amountInCents: 25000,
      currency: 'cad',
      cuid: 'sample-cuid',
      pytuid: 'sample-pytuid',
    },
    MAINTENANCE_INVOICE_SUBMITTED: {
      request: {
        mruid: 'MR-2026-0815',
        title: 'Leaking kitchen faucet',
        invoice: {
          amount: 25000,
          currency: 'CAD',
          description: 'Labour and parts for faucet repair',
        },
      },
      amount: '$250.00',
    },
    MAINTENANCE_INVOICE_APPROVED: {
      request: {
        mruid: 'MR-2026-0815',
        title: 'Leaking kitchen faucet',
        invoice: { amount: 25000, currency: 'CAD' },
      },
      approvedBy: { firstName: 'Sarah', email: 'sarah@mapleridge.com' },
    },
    MAINTENANCE_INVOICE_REJECTED: {
      request: {
        mruid: 'MR-2026-0815',
        title: 'Leaking kitchen faucet',
      },
      rejectedBy: { firstName: 'Sarah', email: 'sarah@mapleridge.com' },
      rejectionReason: 'Amount exceeds approved work order estimate. Please revise.',
    },
    MAINTENANCE_VENDOR_PAID: {
      mruid: 'MR-2026-0815',
      jobTitle: 'Leaking kitchen faucet — repair',
      amountInCents: 25000,
      currency: 'cad',
      transferId: 'tr_sample_abc123',
    },
    MAINTENANCE_WORK_ORDER_SUBMITTED: {
      request: {
        mruid: 'MR-2026-0815',
        title: 'Leaking kitchen faucet',
      },
      workOrder: {
        estimatedCostInCents: 25000,
        scope: 'Replace faulty washer and inspect surrounding pipes',
        notes: 'May need to shut off water to unit for 30 minutes',
        lineItems: [
          {
            description: 'Faucet washer kit',
            quantity: 1,
            unitPriceInCents: 1500,
            amountInCents: 1500,
          },
          {
            description: 'Labour (1.5 hrs)',
            quantity: 1,
            unitPriceInCents: 23500,
            amountInCents: 23500,
          },
        ],
      },
    },
    MAINTENANCE_WORK_ORDER_SUBMITTED_TENANT: {
      request: {
        mruid: 'MR-2026-0815',
        title: 'Leaking kitchen faucet',
      },
      workOrder: {
        estimatedCostInCents: 25000,
        scope: 'Replace faulty washer and inspect surrounding pipes',
      },
    },
    MAINTENANCE_WORK_ORDER_APPROVED: {
      request: {
        mruid: 'MR-2026-0815',
        title: 'Leaking kitchen faucet',
      },
      workOrder: {
        estimatedCostInCents: 25000,
        scope: 'Replace faulty washer and inspect surrounding pipes',
      },
      approvedBy: { firstName: 'Sarah', email: 'sarah@mapleridge.com' },
    },
    MAINTENANCE_WORK_ORDER_REJECTED: {
      request: {
        mruid: 'MR-2026-0815',
        title: 'Leaking kitchen faucet',
      },
      rejectedBy: { firstName: 'Sarah', email: 'sarah@mapleridge.com' },
      rejectionReason: 'Scope is too broad. Please itemize and resubmit.',
    },

    // ── Subscription ─────────────────────────────────────────────
    SUBSCRIPTION_RENEWAL_UPCOMING: {
      currentUser: { firstName: 'Sarah' },
      planName: 'Professional',
      renewalDate: 'August 15, 2026',
      amount: '$49.99',
    },
    SUBSCRIPTION_RENEWAL_RECEIPT: {
      adminName: 'Sarah Chen',
      planName: 'Professional',
      amount: '$49.99',
      nextBillingDate: 'September 15, 2026',
    },

    // ── Guest Pass ───────────────────────────────────────────────
    GUEST_PASS_CODE: {
      visitorName: 'Jane Visitor',
      code: '847291',
      expiryMinutes: 30,
      propertyName: 'Maple Ridge Tower',
      unitNumber: '12A',
      propertyAddress: '456 Oak Avenue, Toronto, ON M5V 2T6',
      hostName: 'John Smith',
      hostPhone: '(416) 555-0789',
    },
  };

  return { ...defaults, ...(mocks[templateType] || {}) };
}
