import { Response } from 'express';
import { httpStatusCodes } from '@utils/constants';
import { LeaseController } from '@controllers/LeaseController';
import { createMockRequestContext, createMockCurrentUser } from '@tests/helpers';

const createMockServices = () => ({
  leaseService: {
    createLease: jest.fn(),
    getFilteredLeases: jest.fn(),
    getLeaseById: jest.fn(),
    updateLease: jest.fn(),
    deleteLease: jest.fn(),
    activateLease: jest.fn(),
    terminateLease: jest.fn(),
    uploadLeaseDocument: jest.fn(),
    getLeaseDocumentUrl: jest.fn(),
    removeLeaseDocument: jest.fn(),
    sendLeaseForSignature: jest.fn(),
    markAsManualySigned: jest.fn(),
    cancelSignature: jest.fn(),
    getSignatureDetails: jest.fn(),
    generateLeasePDF: jest.fn(),
    generateLeasePreview: jest.fn(),
    downloadLeasePDF: jest.fn(),
    getExpiringLeases: jest.fn(),
    getLeaseStats: jest.fn(),
    generatePreviewFromExistingLease: jest.fn(),
  },
  mediaUploadService: {
    handleFiles: jest.fn(),
  },
});

describe('LeaseController', () => {
  let leaseController: LeaseController;
  let mockServices: ReturnType<typeof createMockServices>;
  let mockRequest: any;
  let mockResponse: Response;

  const createMockRequest = (overrides = {}) => ({
    context: createMockRequestContext({
      currentuser: createMockCurrentUser(),
      request: { params: { cuid: 'test-cuid', leaseId: 'test-lease-id' } },
    }),
    params: { cuid: 'test-cuid', leaseId: 'test-lease-id' },
    body: {},
    query: {},
    files: {},
    ...overrides,
  });

  const createMockResponse = (): Response =>
    ({
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }) as unknown as Response;

  beforeEach(() => {
    mockServices = createMockServices();
    mockRequest = createMockRequest();
    mockResponse = createMockResponse();

    leaseController = new LeaseController({
      leaseService: mockServices.leaseService as any,
    });

    jest.clearAllMocks();
  });

  describe('createLease', () => {
    it('should create lease successfully', async () => {
      const mockLeaseData = {
        tenantInfo: { id: 'T123' },
        property: { id: 'P123' },
        fees: { monthlyRent: 1500, securityDeposit: 1500, rentDueDay: 1, currency: 'USD' },
        duration: { startDate: new Date(), endDate: new Date() },
        type: 'fixed_term',
      };
      mockRequest.body = mockLeaseData;
      mockServices.leaseService.createLease.mockResolvedValue({
        success: true,
        data: { luid: 'L123', ...mockLeaseData },
      });

      await leaseController.createLease(mockRequest, mockResponse);

      expect(mockServices.leaseService.createLease).toHaveBeenCalledWith(
        'test-cuid',
        mockLeaseData,
        mockRequest.context
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.any(Object),
        })
      );
    });
  });

  describe('getFilteredLeases', () => {
    it('should return filtered leases with pagination', async () => {
      mockRequest.query = {
        pagination: { page: '1', limit: '10' },
        filter: { status: 'active' },
      };
      mockServices.leaseService.getFilteredLeases.mockResolvedValue({
        success: true,
        data: [
          {
            luid: 'L-2025-001',
            leaseNumber: 'LEASE-001',
            tenantName: 'John Doe',
            propertyAddress: '123 Main St',
            unitNumber: '101',
            monthlyRent: 1500,
            startDate: new Date('2025-01-01'),
            endDate: new Date('2026-01-01'),
            status: 'active',
            sentForSignature: true,
            tenantActivated: true,
          },
        ],
        pagination: { total: 1, currentPage: 1, totalPages: 1, perPage: 10 },
      });

      await leaseController.getFilteredLeases(mockRequest, mockResponse);

      expect(mockServices.leaseService.getFilteredLeases).toHaveBeenCalledWith(
        'test-cuid',
        expect.objectContaining({ status: 'active' }),
        expect.objectContaining({ page: 1, limit: 10 })
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.arrayContaining([
            expect.objectContaining({
              sentForSignature: true,
              tenantActivated: true,
            }),
          ]),
        })
      );
    });

    it('should handle sentForSignature=false when not sent electronically', async () => {
      mockRequest.query = {
        pagination: {},
        filter: {},
      };
      mockServices.leaseService.getFilteredLeases.mockResolvedValue({
        success: true,
        data: [
          {
            luid: 'L-2025-002',
            leaseNumber: 'LEASE-002',
            tenantName: 'Jane Smith',
            propertyAddress: '456 Oak Ave',
            unitNumber: null,
            monthlyRent: 2000,
            startDate: new Date('2025-02-01'),
            endDate: new Date('2026-02-01'),
            status: 'draft',
            sentForSignature: false,
            tenantActivated: false,
          },
        ],
        pagination: { total: 1, currentPage: 1, totalPages: 1, perPage: 10 },
      });

      await leaseController.getFilteredLeases(mockRequest, mockResponse);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.arrayContaining([
            expect.objectContaining({
              sentForSignature: false,
              tenantActivated: false,
            }),
          ]),
        })
      );
    });
  });

  describe('getLeaseById', () => {
    it('should return lease data successfully', async () => {
      const mockLeaseData = {
        lease: {
          luid: 'L-2025-001',
          leaseNumber: 'LEASE-001',
          status: 'active',
          type: 'fixed_term',
          fees: { monthlyRent: 1500, securityDeposit: 1500, currency: 'USD', rentDueDay: 1 },
          duration: { startDate: new Date(), endDate: new Date() },
        },
        property: { id: 'P123', address: '123 Main St' },
        unit: null,
        payments: [],
        documents: [],
        activity: [],
        timeline: {},
        permissions: {},
        financialSummary: {},
      };

      mockRequest.params = { ...mockRequest.params, luid: 'L-2025-001' };
      mockServices.leaseService.getLeaseById.mockResolvedValue({
        success: true,
        data: mockLeaseData,
      });

      await leaseController.getLeaseById(mockRequest, mockResponse);

      expect(mockServices.leaseService.getLeaseById).toHaveBeenCalledWith(
        mockRequest.context,
        'L-2025-001',
        undefined
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.any(Object),
        })
      );
    });
  });

  describe('updateLease', () => {
    it('should return SERVICE_UNAVAILABLE status', async () => {
      await leaseController.updateLease(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.SERVICE_UNAVAILABLE);
    });

    // TODO: Add test cases for implemented functionality
  });

  describe('deleteLease', () => {
    it('should return SERVICE_UNAVAILABLE status', async () => {
      await leaseController.deleteLease(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.SERVICE_UNAVAILABLE);
    });

    // TODO: Add test cases for implemented functionality
  });

  describe('activateLease', () => {
    it('should return NOT_IMPLEMENTED status', async () => {
      await leaseController.activateLease(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.NOT_IMPLEMENTED);
    });

    // TODO: Add test cases for implemented functionality
  });

  describe('terminateLease', () => {
    it('should return NOT_IMPLEMENTED status', async () => {
      await leaseController.terminateLease(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.NOT_IMPLEMENTED);
    });

    // TODO: Add test cases for implemented functionality
  });

  describe('uploadLeaseDocument', () => {
    it('should return NOT_IMPLEMENTED status', async () => {
      await leaseController.uploadLeaseDocument(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.NOT_IMPLEMENTED);
    });

    // TODO: Add test cases for implemented functionality
  });

  describe('getLeaseDocument', () => {
    it('should return NOT_IMPLEMENTED status', async () => {
      await leaseController.getLeaseDocument(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.NOT_IMPLEMENTED);
    });

    // TODO: Add test cases for implemented functionality
  });

  describe('removeLeaseDocument', () => {
    it('should return NOT_IMPLEMENTED status', async () => {
      await leaseController.removeLeaseDocument(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.NOT_IMPLEMENTED);
    });

    // TODO: Add test cases for implemented functionality
  });

  describe('handleSignatureAction', () => {
    it('should return SERVICE_UNAVAILABLE status', async () => {
      await leaseController.handleSignatureAction(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.SERVICE_UNAVAILABLE);
    });

    // TODO: Add test cases for implemented functionality
    // describe('when action is "send"', () => {
    //   it('should send lease for e-signature', async () => {});
    // });
    //
    // describe('when action is "manual"', () => {
    //   it('should mark lease as manually signed', async () => {});
    // });
    //
    // describe('when action is "cancel"', () => {
    //   it('should cancel signature request', async () => {});
    // });
  });

  describe('getSignatureDetails', () => {
    it('should return NOT_IMPLEMENTED status', async () => {
      await leaseController.getSignatureDetails(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.NOT_IMPLEMENTED);
    });

    // TODO: Add test cases for implemented functionality
  });

  describe('generateLeasePDF', () => {
    it('should return NOT_IMPLEMENTED status', async () => {
      await leaseController.generateLeasePDF(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.NOT_IMPLEMENTED);
    });

    // TODO: Add test cases for implemented functionality
  });

  describe('generateLeasePreview', () => {
    it('should return preview HTML successfully', async () => {
      const mockPreviewData = {
        tenantInfo: { id: 'T123' },
        property: { id: 'P123' },
        fees: { monthlyRent: 1500, securityDeposit: 1500 },
        duration: { startDate: new Date(), endDate: new Date() },
        templateType: 'residential-single-family',
      };
      mockRequest.body = mockPreviewData;

      mockServices.leaseService.generateLeasePreview = jest.fn().mockResolvedValue({
        ...mockPreviewData,
        leaseNumber: 'L-2025-001',
      });

      await leaseController.generateLeasePreview(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            html: expect.any(String),
            templateUsed: expect.any(String),
          }),
        })
      );
    });
  });

  describe('getLeaseTemplates', () => {
    it('should return available templates successfully', async () => {
      await leaseController.getLeaseTemplates(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            templates: expect.any(Array),
          }),
        })
      );
    });
  });

  describe('downloadLeasePDF', () => {
    it('should return NOT_IMPLEMENTED status', async () => {
      await leaseController.downloadLeasePDF(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.NOT_IMPLEMENTED);
    });

    // TODO: Add test cases for implemented functionality
  });

  describe('getExpiringLeases', () => {
    it('should return expiring leases successfully', async () => {
      const mockExpiringLeases = [
        {
          luid: 'L-2025-001',
          leaseNumber: 'LEASE-001',
          tenantName: 'John Doe',
          endDate: new Date('2025-06-01'),
        },
      ];

      mockServices.leaseService.getExpiringLeases.mockResolvedValue({
        success: true,
        data: mockExpiringLeases,
        message: 'Found 1 lease(s) expiring within 30 days',
      });

      mockRequest.query = { days: '30' };

      await leaseController.getExpiringLeases(mockRequest, mockResponse);

      expect(mockServices.leaseService.getExpiringLeases).toHaveBeenCalledWith('test-cuid', 30);
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.any(Array),
        })
      );
    });
  });

  describe('getLeaseStats', () => {
    it('should return lease statistics successfully', async () => {
      const mockStats = {
        totalLeases: 10,
        activeLeases: 5,
        expiredLeases: 2,
        pendingLeases: 3,
        totalMonthlyRevenue: 15000,
      };

      mockServices.leaseService.getLeaseStats.mockResolvedValue({
        success: true,
        data: mockStats,
        message: 'Lease statistics retrieved successfully',
      });

      await leaseController.getLeaseStats(mockRequest, mockResponse);

      expect(mockServices.leaseService.getLeaseStats).toHaveBeenCalledWith(
        'test-cuid',
        expect.any(Object)
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.any(Object),
        })
      );
    });
  });

  describe('exportLeases', () => {
    // exportLeases method doesn't exist in the controller - remove or skip this test
    it.skip('should return SERVICE_UNAVAILABLE status', async () => {
      // This method is not implemented in the controller
    });
  });
});
