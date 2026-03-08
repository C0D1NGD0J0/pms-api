import request from 'supertest';
import cookieParser from 'cookie-parser';
import express, { Application } from 'express';
import { ROLES } from '@shared/constants/roles.constants';
import { PaymentController } from '@controllers/PaymentController';
import { PaymentService } from '@services/payments/payments.service';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import { setupAllExternalMocks } from '@tests/setup/externalMocks';
import { beforeEach, beforeAll, afterAll, describe, expect, it, jest } from '@jest/globals';
import { PaymentModel, Client, Profile, User, PaymentProcessor } from '@models/index';
import { disconnectTestDatabase, setupTestDatabase, clearTestDatabase } from '@tests/helpers';
import { createTestClient, createTestUser, createTestProfile } from '@tests/setup/testFactories';
import { PaymentDAO, ClientDAO, ProfileDAO, UserDAO, PaymentProcessorDAO } from '@dao/index';
import { PaymentRecordStatus, PaymentRecordType, PaymentMethod } from '@interfaces/payments.interface';
import { ISuccessReturnData } from '@interfaces/utils.interface';
import { IPaymentGatewayProvider } from '@interfaces/subscription.interface';

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
    await setupTestDatabase();
    setupAllExternalMocks();

    // testFactories use Mongoose models directly
    testClient = await createTestClient();
    adminUser = await createTestUser(testClient.cuid, { roles: [ROLES.ADMIN] });
    testProfile = await createTestProfile(adminUser._id, testClient._id, { type: 'tenant' });

    // Wire up real DAOs with real DB
    const paymentDAO = new PaymentDAO({ paymentModel: PaymentModel });
    const clientDAO = new ClientDAO({ clientModel: Client, userModel: User });
    const profileDAO = new ProfileDAO({ profileModel: Profile });
    const paymentProcessorDAO = new PaymentProcessorDAO({ paymentProcessorModel: PaymentProcessor });

    const paymentService = new PaymentService({
      paymentDAO,
      clientDAO,
      profileDAO,
      paymentProcessorDAO,
      paymentGatewayService: mockPaymentGatewayService,
      subscriptionDAO: {} as any,
      leaseDAO: {} as any,
      userDAO: new UserDAO({ userModel: User }),
      subscriptionPlanConfig: {} as any,
      queueFactory: { getQueue: jest.fn() } as any,
      emitterService: { emit: jest.fn(), on: jest.fn() } as any,
    });

    const paymentController = new PaymentController({ paymentService, mediaUploadService: {} as any });

    app = express();
    app.use(express.json());
    app.use(cookieParser());

    app.post('/api/v1/payments/:cuid/:pytuid/refund', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      return paymentController.refundPayment(req as any, res);
    });

    app.patch('/api/v1/payments/:cuid/:pytuid/cancel', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      return paymentController.cancelPayment(req as any, res);
    });
  });

  afterAll(async () => {
    await disconnectTestDatabase();
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
      { cuid: testClient.cuid, accountId: 'acct_test_123', provider: IPaymentGatewayProvider.STRIPE },
      { upsert: true, new: true }
    );
  });

  describe('POST /api/v1/payments/:cuid/:pytuid/refund', () => {
    it('should process a full refund of a PAID payment', async () => {
      (mockCreateRefund as jest.Mock).mockReturnValue(Promise.resolve({
        success: true,
        data: { refundId: 're_test_123', status: 'succeeded', amount: 150000, currency: 'usd' },
      }));

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
      (mockCreateRefund as jest.Mock).mockReturnValue(Promise.resolve({
        success: true,
        data: { refundId: 're_test_456', status: 'succeeded', amount: 50000, currency: 'usd' },
      }));

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
});
