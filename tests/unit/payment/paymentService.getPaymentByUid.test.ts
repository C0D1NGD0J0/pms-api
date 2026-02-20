import { Types } from 'mongoose';
import { SubscriptionPlanConfig } from '@services/subscription';
import { PaymentService } from '@services/payments/payments.service';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { PaymentRecordStatus, PaymentRecordType } from '@interfaces/index';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import {
  PaymentProcessorDAO,
  SubscriptionDAO,
  PaymentDAO,
  ProfileDAO,
  ClientDAO,
  LeaseDAO,
  UserDAO,
} from '@dao/index';

describe('PaymentService - getPaymentByUid', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;

  const CUID = 'CLIENT001';
  const PYTUID = 'PYT001';

  const mockClient = { _id: new Types.ObjectId(), cuid: CUID };

  const makeMockPayment = (overrides: Record<string, any> = {}) => ({
    pytuid: PYTUID,
    cuid: CUID,
    invoiceNumber: 'INV-2026-0041',
    paymentType: PaymentRecordType.RENT,
    status: PaymentRecordStatus.PAID,
    baseAmount: 185000,
    processingFee: 2775,
    dueDate: new Date('2026-02-01'),
    paidAt: new Date('2026-02-01T10:22:00Z'),
    tenant: {
      puid: 'PUID001',
      personalInfo: { firstName: 'Marcus', lastName: 'Johnson' },
      user: { email: 'marcus.j@email.com' },
    },
    lease: {
      luid: 'LEASE001',
      leaseNumber: 'LSE-2025-0014',
      status: 'active',
      duration: {
        startDate: new Date('2025-03-01'),
        endDate: new Date('2026-02-28'),
      },
      property: {
        address: '12 Sunset Blvd, Los Angeles, CA 90028',
        unitNumber: '4A',
        name: 'Sunset Apartments',
        propertyType: 'residential',
        specifications: { bedrooms: 2, bathrooms: 1 },
      },
    },
    toObject() {
      const { tenant, lease, toObject, ...rest } = this as any;
      return { ...rest };
    },
    ...overrides,
  });

  beforeEach(() => {
    mockClientDAO = {
      findFirst: jest.fn().mockResolvedValue(mockClient),
    } as any;

    mockPaymentDAO = {
      findFirst: jest.fn(),
      findByCuid: jest.fn(),
      update: jest.fn(),
    } as any;

    paymentService = new PaymentService({
      clientDAO: mockClientDAO,
      paymentDAO: mockPaymentDAO,
      paymentProcessorDAO: {} as jest.Mocked<PaymentProcessorDAO>,
      profileDAO: {} as jest.Mocked<ProfileDAO>,
      subscriptionDAO: {} as jest.Mocked<SubscriptionDAO>,
      leaseDAO: {} as jest.Mocked<LeaseDAO>,
      userDAO: {} as jest.Mocked<UserDAO>,
      paymentGatewayService: {} as jest.Mocked<PaymentGatewayService>,
      subscriptionPlanConfig: {} as jest.Mocked<SubscriptionPlanConfig>,
    });
  });

  describe('success cases', () => {
    it('should return payment with full leaseInfo including unit and property details', async () => {
      mockPaymentDAO.findFirst.mockResolvedValue(makeMockPayment() as any);

      const result = await paymentService.getPaymentByUid(CUID, PYTUID);

      expect(result.success).toBe(true);
      expect(result.data.leaseInfo).toEqual({
        address: '12 Sunset Blvd, Los Angeles, CA 90028',
        leaseNumber: 'LSE-2025-0014',
        status: 'active',
        leaseUid: 'LEASE001',
        startDate: new Date('2025-03-01'),
        endDate: new Date('2026-02-28'),
        unitNumber: '4A',
        propertyName: 'Sunset Apartments',
        propertyType: 'residential',
        bedrooms: 2,
        bathrooms: 1,
      });
    });

    it('should return correct tenantProfile with name and email', async () => {
      mockPaymentDAO.findFirst.mockResolvedValue(makeMockPayment() as any);

      const result = await paymentService.getPaymentByUid(CUID, PYTUID);

      expect(result.data.tenantProfile).toEqual({
        firstName: 'Marcus',
        lastName: 'Johnson',
        email: 'marcus.j@email.com',
        puid: 'PUID001',
      });
    });

    it('should return leaseInfo as null when payment has no lease', async () => {
      mockPaymentDAO.findFirst.mockResolvedValue(
        makeMockPayment({ lease: null }) as any
      );

      const result = await paymentService.getPaymentByUid(CUID, PYTUID);

      expect(result.success).toBe(true);
      expect(result.data.leaseInfo).toBeNull();
    });

    it('should handle lease with no unit number or specifications', async () => {
      const payment = makeMockPayment();
      payment.lease.property = {
        address: '5 Harbor St',
        name: 'Harbor View',
      } as any;
      mockPaymentDAO.findFirst.mockResolvedValue(payment as any);

      const result = await paymentService.getPaymentByUid(CUID, PYTUID);

      expect(result.data.leaseInfo?.unitNumber).toBeUndefined();
      expect(result.data.leaseInfo?.bedrooms).toBeUndefined();
      expect(result.data.leaseInfo?.bathrooms).toBeUndefined();
      expect(result.data.leaseInfo?.propertyName).toBe('Harbor View');
    });

    it('should strip tenant and lease from the raw paymentObj', async () => {
      mockPaymentDAO.findFirst.mockResolvedValue(makeMockPayment() as any);

      const result = await paymentService.getPaymentByUid(CUID, PYTUID);

      expect(result.data).not.toHaveProperty('tenant');
      expect(result.data).not.toHaveProperty('lease');
    });

    it('should populate payment with tenant user and lease paths', async () => {
      mockPaymentDAO.findFirst.mockResolvedValue(makeMockPayment() as any);

      await paymentService.getPaymentByUid(CUID, PYTUID);

      expect(mockPaymentDAO.findFirst).toHaveBeenCalledWith(
        { pytuid: PYTUID, cuid: CUID, deletedAt: null },
        {
          populate: [
            { path: 'tenant', populate: { path: 'user' } },
            'lease',
          ],
        }
      );
    });
  });

  describe('error cases', () => {
    it('should throw BadRequestError when cuid is missing', async () => {
      await expect(paymentService.getPaymentByUid('', PYTUID)).rejects.toThrow(
        BadRequestError
      );
    });

    it('should throw BadRequestError when pytuid is missing', async () => {
      await expect(paymentService.getPaymentByUid(CUID, '')).rejects.toThrow(
        BadRequestError
      );
    });

    it('should throw NotFoundError when client does not exist', async () => {
      mockClientDAO.findFirst.mockResolvedValue(null);

      await expect(
        paymentService.getPaymentByUid(CUID, PYTUID)
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when payment does not exist', async () => {
      mockPaymentDAO.findFirst.mockResolvedValue(null);

      await expect(
        paymentService.getPaymentByUid(CUID, PYTUID)
      ).rejects.toThrow(NotFoundError);
    });
  });
});
