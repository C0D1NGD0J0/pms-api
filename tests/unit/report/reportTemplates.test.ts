import ejs from 'ejs';
import path from 'path';
import { REPORT_SECTIONS } from '@interfaces/report.interface';

const PDF_TEMPLATE_PATH = path.join(__dirname, '../../../app/templates/reports/report.ejs');
const EMAIL_HTML_PATH = path.join(
  __dirname,
  '../../../app/mailer/templates/report/report-ready.ejs'
);
const EMAIL_TEXT_PATH = path.join(
  __dirname,
  '../../../app/mailer/templates/report/report-ready.text.ejs'
);

function makeTemplateData(overrides: Record<string, any> = {}) {
  return {
    clientName: 'Test Property Management',
    period: 'last_30_days',
    startDate: new Date('2026-08-01'),
    endDate: new Date('2026-08-31'),
    prevStartDate: new Date('2026-07-01'),
    prevEndDate: new Date('2026-07-31'),
    generatedAt: new Date(),
    sections: [...REPORT_SECTIONS],
    trends: {},

    // Executive summary data
    unitCounts: { total: 20, occupied: 18, vacant: 2, occupancyRate: 90 },
    leaseStats: {
      activeLeases: 18,
      expiringIn30Days: 2,
      expiringIn60Days: 4,
      expiringIn90Days: 5,
    },
    paymentStats: {
      byCurrency: [
        { currency: 'CAD', totalRevenue: 5000000, monthRevenue: 500000, pendingAmount: 120000 },
      ],
      overdueCount: 3,
      totalCount: 50,
      onTimeRate: 92.5,
      avgPaymentDelayDays: 2.3,
    },

    // P&L data
    pnl: {
      byCurrency: [
        {
          currency: 'CAD',
          income: {
            total: 5000000,
            byProperty: [{ propertyName: '123 Main St', total: 3000000 }],
          },
          expenses: {
            total: 1500000,
            byCategory: [{ category: 'repairs', total: 800000 }],
          },
          netIncome: 3500000,
        },
      ],
    },

    // Lease data
    rentRoll: [
      {
        tenantName: 'John Doe',
        propertyName: '123 Main St',
        unitNumber: '101',
        monthlyRent: 150000,
        leaseEndDate: new Date('2027-03-31'),
      },
    ],
    expiringLeases: [
      {
        tenantId: { email: 'john@test.com' },
        propertyId: { name: '123 Main St' },
        endDate: new Date('2026-10-31'),
      },
    ],

    // Payment data
    recentPayments: {
      items: [
        {
          tenantId: { email: 'john@test.com' },
          paymentType: 'rent',
          baseAmount: 150000,
          dueDate: new Date('2026-08-01'),
          status: 'paid',
        },
      ],
    },

    // Maintenance data
    maintenanceStats: { total: 15, open: 3, completed: 10, avgResolutionDays: 4.2 },
    recentWorkOrders: {
      items: [
        {
          title: 'Fix leak',
          propertyId: { name: '123 Main St' },
          priority: 'high',
          status: 'completed',
          createdAt: new Date(),
        },
      ],
    },

    // Expense data
    expenseByCategory: [{ _id: { category: 'repairs', currency: 'CAD' }, total: 800000 }],
    expenseByProperty: [{ _id: { propertyId: 'prop-1', currency: 'CAD' }, total: 500000 }],
    recentExpenses: {
      items: [
        { description: 'Plumber repair', category: 'repairs', amount: 25000, date: new Date() },
      ],
    },

    // Tenant/user data
    tenantStats: { activeTenants: 18 },
    userStats: { total: 25, tenants: 18, staff: 7 },

    // Vendor data
    vendorStats: {
      totalVendors: 5,
      businessTypeDistribution: [{ _id: 'plumbing', count: 2 }],
      servicesDistribution: [],
    },

    // Inspection data
    inspectionStats: {
      total: 8,
      scheduled: 2,
      approved: 5,
      avgCompletionDays: 3.5,
    },

    ...overrides,
  };
}

describe('Report PDF Template', () => {
  it('should render with all sections and full data', async () => {
    const html = await ejs.renderFile(PDF_TEMPLATE_PATH, makeTemplateData());

    expect(html).toContain('Test Property Management');
    expect(html).toContain('Executive Summary');
    expect(html).toContain('Financial Overview');
    expect(html).toContain('Payment Analysis');
    expect(html).toContain('Lease & Occupancy');
    expect(html).toContain('Maintenance & Work Orders');
    expect(html).toContain('Expense Breakdown');
    expect(html).toContain('Tenant Summary');
    expect(html).toContain('Vendor Summary');
    expect(html).toContain('Inspection Summary');
  });

  it('should render with a subset of sections', async () => {
    const html = await ejs.renderFile(
      PDF_TEMPLATE_PATH,
      makeTemplateData({ sections: ['executive_summary', 'payment_analysis'] })
    );

    expect(html).toContain('Executive Summary');
    expect(html).toContain('Payment Analysis');
    expect(html).not.toContain('<h2>Financial Overview</h2>');
    expect(html).not.toContain('<h2>Maintenance');
    expect(html).not.toContain('<h2>Vendor Summary</h2>');
  });

  it('should render with empty data without crashing', async () => {
    const html = await ejs.renderFile(
      PDF_TEMPLATE_PATH,
      makeTemplateData({
        unitCounts: null,
        leaseStats: null,
        paymentStats: null,
        pnl: null,
        rentRoll: null,
        expiringLeases: null,
        recentPayments: null,
        maintenanceStats: null,
        recentWorkOrders: null,
        expenseByCategory: null,
        expenseByProperty: null,
        recentExpenses: null,
        tenantStats: null,
        userStats: null,
        vendorStats: null,
        inspectionStats: null,
        trends: {},
      })
    );

    expect(html).toContain('Test Property Management');
    expect(html).toContain('Property Management Report');
  });

  it('should render trend badges when trend data is present', async () => {
    const html = await ejs.renderFile(
      PDF_TEMPLATE_PATH,
      makeTemplateData({
        trends: {
          occupancyRate: { current: 90, previous: 85, delta: 5, deltaPercent: 5.9 },
          activeLeases: { current: 18, previous: 16, delta: 2, deltaPercent: 12.5 },
          revenue: { CAD: { current: 500000, previous: 450000, delta: 50000, deltaPercent: 11.1 } },
        },
      })
    );

    expect(html).toContain('trend up');
    expect(html).toContain('+5.9%');
  });

  it('should render cost metrics with inverted trend (red for increase)', async () => {
    const html = await ejs.renderFile(
      PDF_TEMPLATE_PATH,
      makeTemplateData({
        sections: ['financial_overview', 'maintenance'],
        trends: {
          totalExpenses: {
            CAD: { current: 200000, previous: 150000, delta: 50000, deltaPercent: 33.3 },
          },
          openWorkOrders: { current: 10, previous: 5, delta: 5, deltaPercent: 100 },
        },
      })
    );

    // Expenses going up = bad = red (trend down class)
    // Open work orders going up = bad = red (trend down class)
    expect(html).toContain('trend down');
  });

  it('should render multi-currency payment stats', async () => {
    const html = await ejs.renderFile(
      PDF_TEMPLATE_PATH,
      makeTemplateData({
        paymentStats: {
          byCurrency: [
            { currency: 'CAD', totalRevenue: 5000000, monthRevenue: 500000, pendingAmount: 120000 },
            { currency: 'USD', totalRevenue: 2000000, monthRevenue: 200000, pendingAmount: 50000 },
          ],
          overdueCount: 3,
          totalCount: 50,
          onTimeRate: 92.5,
          avgPaymentDelayDays: 2.3,
        },
      })
    );

    expect(html).toContain('CAD');
    expect(html).toContain('USD');
  });

  it('should show custom period label for custom date range', async () => {
    const html = await ejs.renderFile(PDF_TEMPLATE_PATH, makeTemplateData({ period: 'custom' }));

    // Custom period renders the startDate – endDate range
    const expectedStart = new Date('2026-08-01').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    expect(html).toContain(expectedStart);
  });

  it('should render cover page with client name and metadata', async () => {
    const html = await ejs.renderFile(PDF_TEMPLATE_PATH, makeTemplateData());

    expect(html).toContain('Test Property Management');
    expect(html).toContain('Property Management Report');
    expect(html).toContain('Last 30 Days');
    expect(html).toContain('9 of 9');
  });
});

// ─── Email Templates ─────────────────────────────────────────────────

const emailData = {
  periodLabel: 'Monthly',
  clientName: 'Test Property Management',
  filename: 'report-2026-08-29.pdf',
  presignedUrl: 'https://s3.example.com/reports/report.pdf?signed=abc123',
  expiresAt: new Date('2026-08-29T13:00:00Z').toISOString(),
};

describe('Report Email HTML Template', () => {
  it('should render with all required variables', async () => {
    const html = await ejs.renderFile(EMAIL_HTML_PATH, emailData);

    expect(html).toContain('Your Report is Ready');
    expect(html).toContain('Test Property Management');
    expect(html).toContain('Monthly');
    expect(html).toContain('report-2026-08-29.pdf');
    expect(html).toContain('Download Report');
    expect(html).toContain('expires in 1 hour');
  });

  it('should include the presigned URL in the download button', async () => {
    const html = await ejs.renderFile(EMAIL_HTML_PATH, emailData);

    expect(html).toContain('https://s3.example.com/reports/report.pdf?signed=abc123');
  });

  it('should render detail card with report info', async () => {
    const html = await ejs.renderFile(EMAIL_HTML_PATH, emailData);

    expect(html).toContain('Report Details');
    expect(html).toContain('detail-card');
  });
});

describe('Report Email Text Template', () => {
  it('should render with all required variables', async () => {
    const text = await ejs.renderFile(EMAIL_TEXT_PATH, emailData);

    expect(text).toContain('Your Report is Ready');
    expect(text).toContain('Test Property Management');
    expect(text).toContain('Monthly');
    expect(text).toContain('report-2026-08-29.pdf');
    expect(text).toContain('https://s3.example.com/reports/report.pdf?signed=abc123');
    expect(text).toContain('expires in 1 hour');
  });

  it('should not contain HTML tags', async () => {
    const text = await ejs.renderFile(EMAIL_TEXT_PATH, emailData);

    expect(text).not.toContain('<table');
    expect(text).not.toContain('<div');
    expect(text).not.toContain('<td');
  });
});
