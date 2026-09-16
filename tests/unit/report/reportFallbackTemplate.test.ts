import ejs from 'ejs';
import path from 'path';

const FALLBACK_TEMPLATE_PATH = path.join(
  __dirname,
  '../../../app/templates/reports/partials/executive-analysis-fallback.ejs'
);

function makeData(overrides: Record<string, any> = {}) {
  return {
    unitCounts: { total: 20, occupied: 18, vacant: 2, occupancyRate: 90 },
    paymentStats: {
      byCurrency: [
        { currency: 'CAD', totalRevenue: 5000000, monthRevenue: 500000, pendingAmount: 120000 },
      ],
      overdueCount: 3,
      totalCount: 50,
      onTimeRate: 92.5,
      avgPaymentDelayDays: 2.3,
    },
    leaseStats: { activeLeases: 18, expiringIn30Days: 2, expiringIn90Days: 5 },
    maintenanceStats: { total: 15, open: 3, completed: 10, avgResolutionDays: 4.2 },
    pnl: {
      byCurrency: [
        {
          currency: 'CAD',
          income: { total: 5000000 },
          expenses: { total: 1500000 },
          netIncome: 3500000,
        },
      ],
    },
    inspectionStats: { total: 8, approved: 5, scheduled: 2, avgCompletionDays: 3.5 },
    trends: {},
    period: 'last_30_days',
    ...overrides,
  };
}

describe('Fallback Executive Analysis Template', () => {
  it('should render with full data without crashing', async () => {
    const output = await ejs.renderFile(FALLBACK_TEMPLATE_PATH, makeData());

    expect(output).toContain('90%');
    expect(output).toContain('18 of 20 units');
    expect(output).toContain('2 vacant');
  });

  it('should include payment stats', async () => {
    const output = await ejs.renderFile(FALLBACK_TEMPLATE_PATH, makeData());

    expect(output).toContain('CAD');
    expect(output).toContain('92.5%');
    expect(output).toContain('3 overdue');
  });

  it('should include lease stats', async () => {
    const output = await ejs.renderFile(FALLBACK_TEMPLATE_PATH, makeData());

    expect(output).toContain('18 active leases');
    expect(output).toContain('2 expiring in the next 30 days');
  });

  it('should include maintenance stats', async () => {
    const output = await ejs.renderFile(FALLBACK_TEMPLATE_PATH, makeData());

    expect(output).toContain('15 work orders');
    expect(output).toContain('3 currently open');
  });

  it('should include P&L data', async () => {
    const output = await ejs.renderFile(FALLBACK_TEMPLATE_PATH, makeData());

    expect(output).toContain('net income');
    expect(output).toContain('CAD');
  });

  it('should include inspection stats', async () => {
    const output = await ejs.renderFile(FALLBACK_TEMPLATE_PATH, makeData());

    expect(output).toContain('8 inspections');
    expect(output).toContain('5 approved');
  });

  it('should render trend info when trends are present', async () => {
    const output = await ejs.renderFile(
      FALLBACK_TEMPLATE_PATH,
      makeData({
        trends: {
          occupancyRate: { current: 90, previous: 85, delta: 5, deltaPercent: 5.9 },
        },
      })
    );

    expect(output).toContain('up');
    expect(output).toContain('5.9%');
  });

  it('should handle null sections gracefully', async () => {
    const output = await ejs.renderFile(
      FALLBACK_TEMPLATE_PATH,
      makeData({
        unitCounts: null,
        paymentStats: null,
        leaseStats: null,
        maintenanceStats: null,
        pnl: null,
        inspectionStats: null,
      })
    );

    // Should produce output without crashing (may be mostly empty)
    expect(typeof output).toBe('string');
  });
});
