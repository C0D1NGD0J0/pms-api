import request from 'supertest';
import cookieParser from 'cookie-parser';
import express, { Application } from 'express';
import { clearTestDatabase } from '@tests/helpers';
import { ROLES } from '@shared/constants/roles.constants';
import { PaymentController } from '@controllers/PaymentController';
import { setupAllExternalMocks } from '@tests/setup/externalMocks';
import { PaymentService } from '@services/payments/payments.service';
import { errorHandlerMiddleware } from '@shared/middlewares/error-handler';
import { IPaymentGatewayProvider } from '@interfaces/subscription.interface';
import { beforeEach, beforeAll, describe, expect, jest, it } from '@jest/globals';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import { PaymentProcessor, PaymentModel, Profile, Client, Lease, User } from '@models/index';
import { createTestProfile, createTestClient, createTestUser } from '@tests/setup/testFactories';
import { PaymentProcessorDAO, PaymentDAO, ProfileDAO, ClientDAO, LeaseDAO, UserDAO } from '@dao/index';
import {
  PaymentRecordStatus,
  PaymentRecordType,
  PaymentMethod,
} from '@interfaces/payments.interface';

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
    const paymentDAO = new PaymentDAO({ paymentModel: PaymentModel });
    const clientDAO = new ClientDAO({ clientModel: Client, userModel: User });
    const profileDAO = new ProfileDAO({ profileModel: Profile });
    const paymentProcessorDAO = new PaymentProcessorDAO({
      paymentProcessorModel: PaymentProcessor,
    });

    const paymentService = new PaymentService({
      paymentDAO,
      clientDAO,
      profileDAO,
      paymentProcessorDAO,
      paymentGatewayService: mockPaymentGatewayService,
      subscriptionDAO: {} as any,
      leaseDAO: new LeaseDAO({ leaseModel: Lease }),
      userDAO: new UserDAO({ userModel: User }),
      subscriptionPlanConfig: {} as any,
      queueFactory: { getQueue: jest.fn() } as any,
      pdfGeneratorService: {} as any,
      emitterService: { emit: jest.fn(), on: jest.fn() } as any,
    });

    const paymentController = new PaymentController({
      paymentService,
      mediaUploadService: {} as any,
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

    app.use(errorHandlerMiddleware as any);
  });

  beforeEach(async () => {
    await clearTestDatabase();
    await PaymentModel.deleteMany({});
    jest.clearAllMocks();

    testPayment = await PaymentModel.create({
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
      await PaymentModel.findByIdAndUpdate(testPayment._id, {
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
      await PaymentModel.findByIdAndUpdate(testPayment._id, {
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
      const manualPayment = await PaymentModel.create({
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
    let localClient: any;
    let tenantUser: any;
    let tenantProfile: any;

    beforeEach(async () => {
      localClient = await createTestClient();
      tenantUser = await createTestUser(localClient.cuid, { roles: ['tenant'] });
      tenantProfile = await createTestProfile(tenantUser._id, localClient._id, { type: 'tenant' });
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

      const created = await PaymentModel.findOne({ maintenanceRequestUid: 'MR-TEST-001' });
      expect(created).not.toBeNull();
      expect(created!.status).toBe(PaymentRecordStatus.PENDING);
      expect(created!.paymentType).toBe(PaymentRecordType.MAINTENANCE);
      expect(created!.baseAmount).toBe(45000);
      expect(created!.isManualEntry).toBe(false);

      // dueDate should be ~5 days from now
      const daysUntilDue =
        (created!.dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
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

      const created = await PaymentModel.findOne({ maintenanceRequestUid: 'MR-TEST-002' });
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
});
