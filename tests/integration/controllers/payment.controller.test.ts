/* eslint-disable @typescript-eslint/no-unused-vars */
import request from 'supertest';
import cookieParser from 'cookie-parser';
import express, { Application } from 'express';
import { clearTestDatabase } from '@tests/helpers';
import { ROLES } from '@shared/constants/roles.constants';
import { IClientDocument } from '@interfaces/client.interface';
import { PaymentController } from '@controllers/PaymentController';
import { setupAllExternalMocks } from '@tests/setup/externalMocks';
import { IProfileDocument, IUserDocument } from '@interfaces/index';
import { PaymentService } from '@services/payments/payments.service';
import { errorHandlerMiddleware } from '@shared/middlewares/error-handler';
import { RentPaymentService } from '@services/payments/rentPayment.service';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import { createTestProfile, createTestClient, createTestUser } from '@tests/setup/testFactories';
import { IPaymentGatewayProvider, ISubscriptionStatus } from '@interfaces/subscription.interface';
import {
  PaymentRecordStatus,
  PaymentRecordType,
  PaymentMethod,
} from '@interfaces/payments.interface';
import {
  PaymentProcessor,
  Payment,
  Subscription,
  Profile,
  Client,
  Lease,
  User,
} from '@models/index';
import {
  PaymentProcessorDAO,
  SubscriptionDAO,
  PaymentDAO,
  ProfileDAO,
  ClientDAO,
  LeaseDAO,
  UserDAO,
} from '@dao/index';

describe('PaymentController Integration Tests', () => {
  let app: Application;
  let testClient: any;
  let adminUser: any;
  let testProfile: any;
  let testPayment: any;

  const mockContext = (user: any, cuid: string) => ({
    currentuser: {
      sub: user._id.toString(),
      uid: user.uid,
      email: user.email,
      activecuid: cuid,
      client: {
        cuid,
        role: ROLES.ADMIN,
      },
    },
  });

  // Mock the gateway service — Stripe/PayPal are external service boundaries
  const mockCreateRefund = jest.fn();
  const mockRequestInvoice = jest.fn();
  const mockHandleFiles = jest.fn();
  const mockPaymentGatewayService = {
    createRefund: mockCreateRefund,
    createCustomer: jest.fn(),
    createInvoice: jest.fn(),
    finalizeInvoice: jest.fn(),
    verifyWebhook: jest.fn(),
  } as unknown as PaymentGatewayService;

  beforeAll(async () => {
    setupAllExternalMocks();

    // testFactories use Mongoose models directly
    testClient = await createTestClient();
    adminUser = await createTestUser(testClient.cuid, { roles: [ROLES.ADMIN] });
    testProfile = await createTestProfile(adminUser._id, testClient._id, { type: 'tenant' });

    // Wire up real DAOs with real DB
    const paymentDAO = new PaymentDAO({ paymentModel: Payment });
    const clientDAO = new ClientDAO({ clientModel: Client, userModel: User });
    const profileDAO = new ProfileDAO({ profileModel: Profile });
    const paymentProcessorDAO = new PaymentProcessorDAO({
      paymentProcessorModel: PaymentProcessor,
    });

    const subscriptionDAO = new SubscriptionDAO();
    const leaseDAO = new LeaseDAO({ leaseModel: Lease });
    const userDAO = new UserDAO({ userModel: User });
    const emitterService = { emit: jest.fn(), on: jest.fn() } as any;
    const subscriptionPlanConfig = {} as any;
    const queueFactory = { getQueue: jest.fn() } as any;
    const invoiceDAO = {} as any;
    const stripeService = {} as any;

    const rentPaymentService = new RentPaymentService({
      subscriptionPlanConfig,
      paymentGatewayService: mockPaymentGatewayService,
      paymentWebhookService: {} as any,
      paymentProcessorDAO,
      emitterService,
      subscriptionDAO,
      paymentCronService: {} as any,
      queueFactory,
      paymentDAO,
      profileDAO,
      clientDAO,
      leaseDAO,
    });

    const paymentService = new PaymentService({
      maintenancePaymentService: {} as any,
      paymentWebhookService: {} as any,
      payoutAccountService: {} as any,
      paymentCronService: {} as any,
      rentPaymentService,
      invoiceTemplateRenderer: {
        render: jest.fn().mockReturnValue(Promise.resolve('<html></html>')),
      } as any,
      subscriptionPlanConfig,
      paymentGatewayService: mockPaymentGatewayService,
      pdfGeneratorService: {} as any,
      paymentProcessorDAO,
      emitterService,
      subscriptionDAO,
      stripeService,
      invoiceDAO,
      paymentDAO,
      profileDAO,
      clientDAO,
      leaseDAO,
      userDAO,
    });

    mockHandleFiles.mockReturnValue(Promise.resolve({ hasFiles: false }));
    mockRequestInvoice.mockReturnValue(Promise.resolve({ status: 'queued', jobId: 'job-123' }));

    const paymentController = new PaymentController({
      paymentService,
      mediaUploadService: { handleFiles: mockHandleFiles } as any,
      invoiceService: { requestInvoice: mockRequestInvoice } as any,
      cronService: {} as any,
    });

    app = express();
    app.use(express.json());
    app.use(cookieParser());

    app.post('/api/v1/payments/:cuid/:pytuid/refund', (req: any, res: any, next: any) => {
      req.context = mockContext(adminUser, req.params.cuid);
      paymentController.refundPayment(req, res).catch(next);
    });

    app.patch('/api/v1/payments/:cuid/:pytuid/cancel', (req: any, res: any, next: any) => {
      req.context = mockContext(adminUser, req.params.cuid);
      paymentController.cancelPayment(req, res).catch(next);
    });

    app.post('/api/v1/payments/:cuid/maintenance-charge', (req: any, res: any, next: any) => {
      req.context = mockContext(adminUser, req.params.cuid);
      paymentController.chargeForMaintenance(req, res).catch(next);
    });

    app.get('/api/v1/payments/:cuid/stats', (req: any, res: any, next: any) => {
      req.context = mockContext(adminUser, req.params.cuid);
      paymentController.getPaymentStats(req, res).catch(next);
    });

    app.post('/api/v1/payments/:cuid/manual_entry', (req: any, res: any, next: any) => {
      req.context = mockContext(adminUser, req.params.cuid);
      // Simulate multer populating req.files (no files in these tests)
      req.files = [];
      paymentController.recordManualPayment(req, res).catch(next);
    });

    app.get('/api/v1/payments/:cuid/stats/as-tenant', (req: any, res: any, next: any) => {
      // Simulate a tenant calling the stats endpoint
      req.context = {
        currentuser: {
          sub: adminUser._id.toString(),
          uid: adminUser.uid,
          email: adminUser.email,
          client: { cuid: req.params.cuid, role: ROLES.TENANT },
        },
      };
      paymentController.getPaymentStats(req, res).catch(next);
    });

    app.use(errorHandlerMiddleware as any);
  });

  beforeEach(async () => {
    await clearTestDatabase();
    await Payment.deleteMany({});
    jest.clearAllMocks();
    // Restore default mock implementations cleared above
    mockHandleFiles.mockReturnValue(Promise.resolve({ hasFiles: false }));
    mockRequestInvoice.mockReturnValue(Promise.resolve({ status: 'queued', jobId: 'job-123' }));

    testPayment = await Payment.create({
      cuid: testClient.cuid,
      tenant: testProfile._id,
      paymentType: PaymentRecordType.RENT,
      paymentMethod: PaymentMethod.ONLINE,
      status: PaymentRecordStatus.PAID,
      baseAmount: 150000,
      processingFee: 0,
      dueDate: new Date(),
      paidAt: new Date(),
      isManualEntry: false,
      gatewayPaymentId: 'inv_test_123',
      gatewayChargeId: 'ch_test_123',
      invoiceNumber: `INV-TEST-${Date.now()}`,
    });

    // Ensure a payment processor record exists
    await PaymentProcessor.findOneAndUpdate(
      { cuid: testClient.cuid },
      {
        cuid: testClient.cuid,
        accountId: 'acct_test_123',
        provider: IPaymentGatewayProvider.STRIPE,
      },
      { upsert: true, new: true }
    );
  });

  describe('POST /api/v1/payments/:cuid/:pytuid/refund', () => {
    it('should process a full refund of a PAID payment', async () => {
      (mockCreateRefund as jest.Mock).mockReturnValue(
        Promise.resolve({
          success: true,
          data: { refundId: 're_test_123', status: 'succeeded', amount: 150000, currency: 'usd' },
        })
      );

      const response = await request(app)
        .post(`/api/v1/payments/${testClient.cuid}/${testPayment.pytuid}/refund`)
        .send({})
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe(PaymentRecordStatus.REFUNDED);
      expect(response.body.data.refund.amount).toBe(150000);
      expect(response.body.data.refund.refundedAt).toBeDefined();

      // Refund must route through gateway — never direct to Stripe
      expect(mockCreateRefund).toHaveBeenCalledWith(
        IPaymentGatewayProvider.STRIPE,
        expect.objectContaining({
          chargeId: 'ch_test_123',
        })
      );
    });

    it('should process a partial refund with a specified amount', async () => {
      (mockCreateRefund as jest.Mock).mockReturnValue(
        Promise.resolve({
          success: true,
          data: { refundId: 're_test_456', status: 'succeeded', amount: 50000, currency: 'usd' },
        })
      );

      const response = await request(app)
        .post(`/api/v1/payments/${testClient.cuid}/${testPayment.pytuid}/refund`)
        .send({ amount: 50000, reason: 'Partial refund requested' })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe(PaymentRecordStatus.REFUNDED);
      expect(response.body.data.refund.amount).toBe(50000);
      expect(response.body.data.refund.reason).toBe('Partial refund requested');
    });

    it('should return 400 when trying to refund a PENDING payment', async () => {
      await Payment.findByIdAndUpdate(testPayment._id, {
        status: PaymentRecordStatus.PENDING,
        gatewayChargeId: null,
        paidAt: null,
      });

      const response = await request(app)
        .post(`/api/v1/payments/${testClient.cuid}/${testPayment.pytuid}/refund`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(mockCreateRefund).not.toHaveBeenCalled();
    });

    it('should return 400 when trying to refund a CANCELLED payment', async () => {
      await Payment.findByIdAndUpdate(testPayment._id, {
        status: PaymentRecordStatus.CANCELLED,
        gatewayChargeId: null,
      });

      const response = await request(app)
        .post(`/api/v1/payments/${testClient.cuid}/${testPayment.pytuid}/refund`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(mockCreateRefund).not.toHaveBeenCalled();
    });

    it('should return 400 when partial amount exceeds original payment amount', async () => {
      const response = await request(app)
        .post(`/api/v1/payments/${testClient.cuid}/${testPayment.pytuid}/refund`)
        .send({ amount: 999999 })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(mockCreateRefund).not.toHaveBeenCalled();
    });

    it('should return 400 for manual entry payments without a gatewayChargeId', async () => {
      const manualPayment = await Payment.create({
        cuid: testClient.cuid,
        tenant: testProfile._id,
        paymentType: PaymentRecordType.RENT,
        paymentMethod: PaymentMethod.CASH,
        status: PaymentRecordStatus.PAID,
        baseAmount: 100000,
        processingFee: 0,
        dueDate: new Date(),
        paidAt: new Date(),
        isManualEntry: true,
        // Provide a period to avoid unique-index conflict with testPayment (lease: null, paymentType: rent, period: null)
        period: { month: 1, year: 2024 },
        invoiceNumber: `INV-MANUAL-${Date.now()}`,
      });

      const response = await request(app)
        .post(`/api/v1/payments/${testClient.cuid}/${manualPayment.pytuid}/refund`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(mockCreateRefund).not.toHaveBeenCalled();
    });

    it('should return 404 for a non-existent payment', async () => {
      const response = await request(app)
        .post(`/api/v1/payments/${testClient.cuid}/nonexistent-pytuid/refund`)
        .send({})
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/payments/:cuid/maintenance-charge', () => {
    // Each test gets a fresh client + tenant — the outer beforeEach calls
    // clearTestDatabase() which wipes testClient from the DB, so we create
    // our own client per test to ensure chargeForMaintenance can find it.
    let localClient: IClientDocument;
    let tenantUser: IUserDocument;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let tenantProfile: IProfileDocument;

    beforeEach(async () => {
      localClient = await createTestClient();
      tenantUser = await createTestUser(localClient.cuid, { roles: ['tenant'] });
      tenantProfile = await createTestProfile(tenantUser._id, localClient._id, { type: 'tenant' });
      // chargeForMaintenance checks for an active subscription before creating a charge
      await Subscription.create({
        cuid: localClient.cuid,
        client: localClient._id,
        planName: 'essential',
        status: ISubscriptionStatus.ACTIVE,
        billingInterval: 'monthly',
        startDate: new Date(),
        entitlements: {
          eSignature: false,
          maintenanceRequestService: false,
          guestPassService: false,
          reportingAnalytics: false,
          leaseTemplates: false,
          vendorManagement: false,
          smsService: false,
          aiTriage: false,
          aiInvoiceScanning: false,
        },
        billing: { provider: IPaymentGatewayProvider.NONE, planId: 'essential-monthly' },
        totalMonthlyPrice: 0,
      });
    });

    it('should create a PENDING maintenance payment linked to the MR uid', async () => {
      const response = await request(app)
        .post(`/api/v1/payments/${localClient.cuid}/maintenance-charge`)
        .send({
          mruid: 'MR-TEST-001',
          tenantId: tenantUser._id.toString(),
          amount: 45000,
          description: 'Pipe replacement charge',
        })
        .expect(201);

      expect(response.body.success).toBe(true);

      const created = await Payment.findOne({ maintenanceRequestUid: 'MR-TEST-001' });
      expect(created).not.toBeNull();
      expect(created!.status).toBe(PaymentRecordStatus.PENDING);
      expect(created!.paymentType).toBe(PaymentRecordType.MAINTENANCE);
      expect(created!.baseAmount).toBe(45000);
      expect(created!.isManualEntry).toBe(false);

      // dueDate should be ~5 days from now
      const daysUntilDue = (created!.dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(daysUntilDue).toBeGreaterThan(4);
      expect(daysUntilDue).toBeLessThan(6);
    });

    it('should use the provided description on the payment record', async () => {
      await request(app)
        .post(`/api/v1/payments/${localClient.cuid}/maintenance-charge`)
        .send({
          mruid: 'MR-TEST-002',
          tenantId: tenantUser._id.toString(),
          amount: 20000,
          description: 'HVAC filter replacement',
        })
        .expect(201);

      const created = await Payment.findOne({ maintenanceRequestUid: 'MR-TEST-002' });
      expect(created!.description).toBe('HVAC filter replacement');
    });

    it('should return 404 when the tenant does not exist', async () => {
      const response = await request(app)
        .post(`/api/v1/payments/${localClient.cuid}/maintenance-charge`)
        .send({
          mruid: 'MR-TEST-003',
          tenantId: '000000000000000000000000', // non-existent user ObjectId
          amount: 10000,
        })
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should return 404 when the client cuid does not exist', async () => {
      const response = await request(app)
        .post('/api/v1/payments/NONEXISTENT-CUID/maintenance-charge')
        .send({
          mruid: 'MR-TEST-004',
          tenantId: tenantUser._id.toString(),
          amount: 10000,
        })
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/payments/:cuid/stats', () => {
    beforeEach(async () => {
      // clearTestDatabase() in the outer beforeEach deletes the client document.
      // Re-insert it so getPaymentStats can find it (the service throws NotFoundError otherwise).
      await Client.findOneAndUpdate(
        { cuid: testClient.cuid },
        {
          cuid: testClient.cuid,
          displayName: 'Test Client',
          status: 'active',
          isVerified: true,
        },
        { upsert: true, new: true }
      );
    });

    it('returns 200 with stats for admin role (client-wide)', async () => {
      const response = await request(app)
        .get(`/api/v1/payments/${testClient.cuid}/stats`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(typeof response.body.data.collected).toBe('number');
      expect(typeof response.body.data.pending).toBe('number');
      expect(typeof response.body.data.overdue).toBe('number');
      expect(typeof response.body.data.collectionRate).toBe('number');
    });

    it('returns 200 with stats scoped to requesting tenant when role is tenant', async () => {
      // The /as-tenant route injects tenant role context pointing to adminUser (the profile exists)
      const response = await request(app)
        .get(`/api/v1/payments/${testClient.cuid}/stats/as-tenant`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(typeof response.body.data.collected).toBe('number');
    });

    it('returns 200 with filtered stats when tenantId query param is provided as admin', async () => {
      const response = await request(app)
        .get(`/api/v1/payments/${testClient.cuid}/stats?tenantId=${testProfile._id.toString()}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      // Only the one PAID testPayment (150000 cents) should be counted
      expect(response.body.data.collected).toBe(150000);
    });

    it('returns 404 when client cuid does not exist', async () => {
      const response = await request(app)
        .get('/api/v1/payments/NONEXISTENT-CUID/stats')
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/payments/:cuid/manual_entry', () => {
    let pmUser: IUserDocument;
    let tenantUser: IUserDocument;
    let localClient: IClientDocument;

    beforeEach(async () => {
      localClient = await createTestClient();
      pmUser = await createTestUser(localClient.cuid, { roles: [ROLES.ADMIN] });
      tenantUser = await createTestUser(localClient.cuid, { roles: [ROLES.TENANT] });
      await createTestProfile(tenantUser._id, localClient._id, { type: 'tenant' });
    });

    it('creates a manual payment record and returns 201', async () => {
      const response = await request(app)
        .post(`/api/v1/payments/${localClient.cuid}/manual_entry`)
        .send({
          paymentType: PaymentRecordType.RENT,
          paymentMethod: PaymentMethod.CASH,
          baseAmount: 120000,
          paidAt: new Date('2026-04-01').toISOString(),
          tenantId: tenantUser._id.toString(),
          period: { month: 4, year: 2026 },
        })
        .expect(201);

      expect(response.body.success).toBe(true);
    });

    it('fires receipt generation as a background task after recording', async () => {
      await request(app)
        .post(`/api/v1/payments/${localClient.cuid}/manual_entry`)
        .send({
          paymentType: PaymentRecordType.RENT,
          paymentMethod: PaymentMethod.CASH,
          baseAmount: 120000,
          paidAt: new Date('2026-04-01').toISOString(),
          tenantId: tenantUser._id.toString(),
          period: { month: 4, year: 2026 },
        })
        .expect(201);

      // Give the fire-and-forget a tick to resolve
      await new Promise((r) => setImmediate(r));

      expect(mockRequestInvoice).toHaveBeenCalledWith(
        expect.any(String), // pytuid
        localClient.cuid
      );
    });

    it('still returns 201 even if background receipt generation fails to queue', async () => {
      mockRequestInvoice.mockImplementation(() => Promise.reject(new Error('Queue unavailable')));

      const response = await request(app)
        .post(`/api/v1/payments/${localClient.cuid}/manual_entry`)
        .send({
          paymentType: PaymentRecordType.RENT,
          paymentMethod: PaymentMethod.CASH,
          baseAmount: 80000,
          paidAt: new Date('2026-05-01').toISOString(),
          tenantId: tenantUser._id.toString(),
          period: { month: 5, year: 2026 },
        })
        .expect(201);

      expect(response.body.success).toBe(true);
    });

    it('returns 404 when client cuid does not exist', async () => {
      const response = await request(app)
        .post('/api/v1/payments/NONEXISTENT-CUID/manual_entry')
        .send({
          paymentType: PaymentRecordType.RENT,
          paymentMethod: PaymentMethod.CASH,
          baseAmount: 100000,
          paidAt: new Date().toISOString(),
          tenantId: tenantUser._id.toString(),
        })
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('returns 404 when tenant does not exist', async () => {
      const response = await request(app)
        .post(`/api/v1/payments/${localClient.cuid}/manual_entry`)
        .send({
          paymentType: PaymentRecordType.RENT,
          paymentMethod: PaymentMethod.CASH,
          baseAmount: 100000,
          paidAt: new Date().toISOString(),
          tenantId: '000000000000000000000000',
        })
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });
});
