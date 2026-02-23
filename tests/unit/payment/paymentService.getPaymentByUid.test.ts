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
  let mockProfileDAO: jest.Mocked<ProfileDAO>;

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
      personalInfo: {
        firstName: 'Marcus',
        lastName: 'Johnson',
        phoneNumber: '+1234567890'
      },
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
        id: {
          _id: new Types.ObjectId(),
          propertyType: 'residential',
          specifications: { bedrooms: 2, bathrooms: 1 },
          status: 'active',
          managedBy: new Types.ObjectId(),
        },
        address: '12 Sunset Blvd, Los Angeles, CA 90028',
        unitNumber: '4A',
        name: 'Sunset Apartments',
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

    mockProfileDAO = {
      findFirst: jest.fn().mockResolvedValue({
        personalInfo: {
          firstName: 'John',
          lastName: 'Manager',
          phoneNumber: '+1987654321',
        },
        user: { email: 'manager@property.com' },
      }),
    } as any;

    paymentService = new PaymentService({
      clientDAO: mockClientDAO,
      paymentDAO: mockPaymentDAO,
      paymentProcessorDAO: {} as jest.Mocked<PaymentProcessorDAO>,
      profileDAO: mockProfileDAO,
      subscriptionDAO: {} as jest.Mocked<SubscriptionDAO>,
      leaseDAO: {} as jest.Mocked<LeaseDAO>,
      userDAO: {} as jest.Mocked<UserDAO>,
      paymentGatewayService: {} as jest.Mocked<PaymentGatewayService>,
      subscriptionPlanConfig: {} as jest.Mocked<SubscriptionPlanConfig>,
    });
  });

  describe('success cases', () => {
    it('should return payment with full leaseInfo including unit, property details, and manager', async () => {
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
        propertyStatus: 'active',
        bedrooms: 2,
        bathrooms: 1,
        propertyManager: {
          fullName: 'John Manager',
          email: 'manager@property.com',
          phoneNumber: '+1987654321',
        },
      });
    });

    it('should return correct tenant with name, email, and phone number', async () => {
      mockPaymentDAO.findFirst.mockResolvedValue(makeMockPayment() as any);

      const result = await paymentService.getPaymentByUid(CUID, PYTUID);

      expect(result.data.tenant).toEqual({
        uid: 'PUID001',
        fullName: 'Marcus Johnson',
        email: 'marcus.j@email.com',
        phoneNumber: '+1234567890',
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
        id: { _id: new Types.ObjectId() } as any,
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

    it('should handle property with no manager', async () => {
      const payment = makeMockPayment();
      payment.lease.property.id.managedBy = null;
      mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
      mockProfileDAO.findFirst.mockResolvedValue(null);

      const result = await paymentService.getPaymentByUid(CUID, PYTUID);

      expect(result.data.leaseInfo?.propertyManager).toBeNull();
    });

    it('should return transformed tenant and property objects (not raw)', async () => {
      mockPaymentDAO.findFirst.mockResolvedValue(makeMockPayment() as any);

      const result = await paymentService.getPaymentByUid(CUID, PYTUID);

      // Should have transformed tenant object
      expect(result.data.tenant).toEqual({
        uid: 'PUID001',
        fullName: 'Marcus Johnson',
        email: 'marcus.j@email.com',
        phoneNumber: '+1234567890',
      });

      // Should have property and leaseInfo
      expect(result.data.property).toBeDefined();
      expect(result.data.leaseInfo).toBeDefined();
    });

    it('should populate payment with correct paths', async () => {
      mockPaymentDAO.findFirst.mockResolvedValue(makeMockPayment() as any);

      await paymentService.getPaymentByUid(CUID, PYTUID);

      expect(mockPaymentDAO.findFirst).toHaveBeenCalledWith(
        { pytuid: PYTUID, cuid: CUID, deletedAt: null },
        {
          populate: [
            {
              path: 'tenant',
              select: 'personalInfo.firstName personalInfo.lastName personalInfo.phoneNumber puid user',
              populate: { path: 'user', select: 'email' },
            },
            {
              path: 'lease',
              select: 'property.id property.address property.name property.unitNumber leaseNumber status duration.startDate duration.endDate luid',
              populate: {
                path: 'property.id',
                select: 'propertyType specifications.bedrooms specifications.bathrooms status managedBy',
              },
            },
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
