import { PropertyUnitController } from '@controllers/PropertyUnitController';
import { PropertyUnitService } from '@services/property';
import { Request, Response } from 'express';
import { AppRequest } from '@interfaces/utils.interface';
import { httpStatusCodes } from '@utils/index';
import { PropertyTestFactory } from '@tests/utils/propertyTestHelpers';
import { AuthTestFactory } from '@tests/utils/authTestHelpers';

jest.mock('@services/property');

describe('PropertyUnitController - Unit Tests', () => {
  let controller: PropertyUnitController;
  let mockPropertyUnitService: jest.Mocked<PropertyUnitService>;
  let mockRequest: Partial<AppRequest>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    mockPropertyUnitService = {
      addPropertyUnit: jest.fn(),
      getPropertyUnits: jest.fn(),
      getPropertyUnit: jest.fn(),
      getJobStatus: jest.fn(),
      getUserJobs: jest.fn(),
      updatePropertyUnit: jest.fn(),
      updateUnitStatus: jest.fn(),
      archiveUnit: jest.fn(),
      setupInspection: jest.fn(),
      addDocumentToUnit: jest.fn(),
      deleteDocumentFromUnit: jest.fn()
    } as any;

    controller = new PropertyUnitController({
      propertyUnitService: mockPropertyUnitService
    });

    mockRequest = {
      body: {},
      params: {},
      query: {},
      context: PropertyTestFactory.createRequestContext()
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('addUnit', () => {
    it('should successfully add a new unit', async () => {
      const unitData = PropertyTestFactory.createPropertyUnit();
      const expectedResult = {
        success: true,
        data: { ...unitData, _id: 'unit123' },
        message: 'Unit added successfully'
      };

      mockRequest.body = unitData;
      mockPropertyUnitService.addPropertyUnit.mockResolvedValue(expectedResult);

      await controller.addUnit(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.addPropertyUnit).toHaveBeenCalledWith(
        mockRequest.context,
        unitData
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith(expectedResult);
    });

    it('should handle service errors when adding unit', async () => {
      const unitData = PropertyTestFactory.createPropertyUnit();
      const errorResult = {
        success: false,
        message: 'Failed to add unit',
        error: 'Validation error'
      };

      mockRequest.body = unitData;
      mockPropertyUnitService.addPropertyUnit.mockResolvedValue(errorResult);

      await controller.addUnit(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.addPropertyUnit).toHaveBeenCalledWith(
        mockRequest.context,
        unitData
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith(errorResult);
    });

    it('should handle empty unit data', async () => {
      mockRequest.body = {};
      const errorResult = {
        success: false,
        message: 'Invalid unit data'
      };

      mockPropertyUnitService.addPropertyUnit.mockResolvedValue(errorResult);

      await controller.addUnit(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.addPropertyUnit).toHaveBeenCalledWith(
        mockRequest.context,
        {}
      );
      expect(mockResponse.json).toHaveBeenCalledWith(errorResult);
    });
  });

  describe('getPropertyUnits', () => {
    it('should get property units with default pagination', async () => {
      const expectedUnits = [
        PropertyTestFactory.createPropertyUnit(),
        PropertyTestFactory.createPropertyUnit()
      ];
      const expectedResult = {
        success: true,
        data: expectedUnits,
        pagination: { page: 1, limit: 10, total: 2 }
      };

      mockRequest.query = {};
      mockPropertyUnitService.getPropertyUnits.mockResolvedValue(expectedResult);

      await controller.getPropertyUnits(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.getPropertyUnits).toHaveBeenCalledWith(
        mockRequest.context,
        {
          page: 1,
          limit: 10,
          sortBy: undefined,
          sort: undefined
        }
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith(expectedResult);
    });

    it('should get property units with custom pagination', async () => {
      const expectedResult = {
        success: true,
        data: [],
        pagination: { page: 2, limit: 5, total: 0 }
      };

      mockRequest.query = {
        page: '2',
        limit: '5',
        sort: 'desc',
        sortBy: 'createdAt'
      };
      mockPropertyUnitService.getPropertyUnits.mockResolvedValue(expectedResult);

      await controller.getPropertyUnits(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.getPropertyUnits).toHaveBeenCalledWith(
        mockRequest.context,
        {
          page: 2,
          limit: 5,
          sortBy: 'createdAt',
          sort: 'desc'
        }
      );
      expect(mockResponse.json).toHaveBeenCalledWith(expectedResult);
    });

    it('should handle invalid pagination parameters', async () => {
      const expectedResult = {
        success: true,
        data: [],
        pagination: { page: 1, limit: 10, total: 0 }
      };

      mockRequest.query = {
        page: 'invalid',
        limit: 'invalid'
      };
      mockPropertyUnitService.getPropertyUnits.mockResolvedValue(expectedResult);

      await controller.getPropertyUnits(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.getPropertyUnits).toHaveBeenCalledWith(
        mockRequest.context,
        {
          page: 1, // Should default to 1 for invalid page
          limit: 10, // Should default to 10 for invalid limit
          sortBy: undefined,
          sort: undefined
        }
      );
    });
  });

  describe('getPropertyUnit', () => {
    it('should get a specific property unit', async () => {
      const expectedUnit = PropertyTestFactory.createPropertyUnit();
      const expectedResult = {
        success: true,
        data: expectedUnit
      };

      mockPropertyUnitService.getPropertyUnit.mockResolvedValue(expectedResult);

      await controller.getPropertyUnit(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.getPropertyUnit).toHaveBeenCalledWith(mockRequest.context);
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith(expectedResult);
    });

    it('should handle unit not found', async () => {
      const expectedResult = {
        success: false,
        message: 'Unit not found'
      };

      mockPropertyUnitService.getPropertyUnit.mockResolvedValue(expectedResult);

      await controller.getPropertyUnit(mockRequest as AppRequest, mockResponse as Response);

      expect(mockResponse.json).toHaveBeenCalledWith(expectedResult);
    });
  });

  describe('getJobStatus', () => {
    it('should get job status by job ID', async () => {
      const jobId = 'job123';
      const expectedResult = {
        success: true,
        data: {
          jobId,
          status: 'completed',
          progress: 100,
          result: 'Job completed successfully'
        }
      };

      mockRequest.params = { jobId };
      mockPropertyUnitService.getJobStatus.mockResolvedValue(expectedResult);

      await controller.getJobStatus(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.getJobStatus).toHaveBeenCalledWith(jobId);
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith(expectedResult);
    });

    it('should handle job not found', async () => {
      const jobId = 'nonexistent';
      const expectedResult = {
        success: false,
        message: 'Job not found'
      };

      mockRequest.params = { jobId };
      mockPropertyUnitService.getJobStatus.mockResolvedValue(expectedResult);

      await controller.getJobStatus(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.getJobStatus).toHaveBeenCalledWith(jobId);
      expect(mockResponse.json).toHaveBeenCalledWith(expectedResult);
    });
  });

  describe('getUserJobs', () => {
    it('should get user jobs for authenticated user', async () => {
      const userId = 'user123';
      const expectedJobs = [
        { jobId: 'job1', status: 'pending', type: 'unit_creation' },
        { jobId: 'job2', status: 'completed', type: 'unit_update' }
      ];

      mockRequest.context = PropertyTestFactory.createRequestContext({
        currentuser: AuthTestFactory.createCurrentUserInfo({ sub: userId })
      });
      mockPropertyUnitService.getUserJobs.mockResolvedValue(expectedJobs);

      await controller.getUserJobs(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.getUserJobs).toHaveBeenCalledWith(userId);
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: expectedJobs
      });
    });

    it('should return unauthorized when user is not authenticated', async () => {
      mockRequest.context = PropertyTestFactory.createRequestContext({
        currentuser: undefined
      });

      await controller.getUserJobs(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.getUserJobs).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.UNAUTHORIZED);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'Unauthorized'
      });
    });

    it('should handle empty user jobs', async () => {
      const userId = 'user123';
      
      mockRequest.context = PropertyTestFactory.createRequestContext({
        currentuser: AuthTestFactory.createCurrentUserInfo({ sub: userId })
      });
      mockPropertyUnitService.getUserJobs.mockResolvedValue([]);

      await controller.getUserJobs(mockRequest as AppRequest, mockResponse as Response);

      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: []
      });
    });
  });

  describe('updateUnit', () => {
    it('should successfully update a unit', async () => {
      const updateData = {
        unitNumber: 'A-1002',
        specifications: { bedrooms: 2, bathrooms: 1 }
      };
      const expectedResult = {
        success: true,
        data: { ...updateData, _id: 'unit123' },
        message: 'Unit updated successfully'
      };

      mockRequest.body = updateData;
      mockPropertyUnitService.updatePropertyUnit.mockResolvedValue(expectedResult);

      await controller.updateUnit(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.updatePropertyUnit).toHaveBeenCalledWith(
        mockRequest.context,
        updateData
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith(expectedResult);
    });

    it('should handle update validation errors', async () => {
      const updateData = { unitNumber: '' };
      const errorResult = {
        success: false,
        message: 'Validation failed',
        errors: ['Unit number is required']
      };

      mockRequest.body = updateData;
      mockPropertyUnitService.updatePropertyUnit.mockResolvedValue(errorResult);

      await controller.updateUnit(mockRequest as AppRequest, mockResponse as Response);

      expect(mockResponse.json).toHaveBeenCalledWith(errorResult);
    });
  });

  describe('updateUnitStatus', () => {
    it('should successfully update unit status', async () => {
      const statusData = { status: 'occupied' };
      const expectedResult = {
        success: true,
        data: { status: 'occupied', updatedAt: new Date() },
        message: 'Unit status updated successfully'
      };

      mockRequest.body = statusData;
      mockPropertyUnitService.updateUnitStatus.mockResolvedValue(expectedResult);

      await controller.updateUnitStatus(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.updateUnitStatus).toHaveBeenCalledWith(
        mockRequest.context,
        statusData
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith(expectedResult);
    });

    it('should handle invalid status values', async () => {
      const statusData = { status: 'invalid_status' };
      const errorResult = {
        success: false,
        message: 'Invalid status value'
      };

      mockRequest.body = statusData;
      mockPropertyUnitService.updateUnitStatus.mockResolvedValue(errorResult);

      await controller.updateUnitStatus(mockRequest as AppRequest, mockResponse as Response);

      expect(mockResponse.json).toHaveBeenCalledWith(errorResult);
    });
  });

  describe('archiveUnit', () => {
    it('should successfully archive a unit', async () => {
      const expectedResult = {
        success: true,
        message: 'Unit archived successfully'
      };

      mockPropertyUnitService.archiveUnit.mockResolvedValue(expectedResult);

      await controller.archiveUnit(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.archiveUnit).toHaveBeenCalledWith(mockRequest.context);
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith(expectedResult);
    });

    it('should handle archive errors', async () => {
      const errorResult = {
        success: false,
        message: 'Cannot archive unit with active lease'
      };

      mockPropertyUnitService.archiveUnit.mockResolvedValue(errorResult);

      await controller.archiveUnit(mockRequest as AppRequest, mockResponse as Response);

      expect(mockResponse.json).toHaveBeenCalledWith(errorResult);
    });
  });

  describe('setupInpection', () => {
    it('should successfully setup inspection', async () => {
      const inspectionData = {
        type: 'move_in',
        scheduledDate: new Date(),
        inspector: 'inspector123'
      };
      const expectedResult = {
        success: true,
        data: { ...inspectionData, _id: 'inspection123' },
        message: 'Inspection scheduled successfully'
      };

      mockRequest.body = inspectionData;
      mockPropertyUnitService.setupInspection.mockResolvedValue(expectedResult);

      await controller.setupInpection(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.setupInspection).toHaveBeenCalledWith(
        mockRequest.context,
        inspectionData
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith(expectedResult);
    });

    it('should handle inspection scheduling conflicts', async () => {
      const inspectionData = {
        type: 'move_out',
        scheduledDate: new Date()
      };
      const errorResult = {
        success: false,
        message: 'Inspector not available at requested time'
      };

      mockRequest.body = inspectionData;
      mockPropertyUnitService.setupInspection.mockResolvedValue(errorResult);

      await controller.setupInpection(mockRequest as AppRequest, mockResponse as Response);

      expect(mockResponse.json).toHaveBeenCalledWith(errorResult);
    });
  });

  describe('addDocumentToUnit', () => {
    it('should successfully add document to unit', async () => {
      const scannedFiles = [
        PropertyTestFactory.createUploadResult(),
        PropertyTestFactory.createUploadResult()
      ];
      const expectedResult = {
        success: true,
        data: { documents: scannedFiles },
        message: 'Documents added successfully'
      };

      mockRequest.body = { scannedFiles };
      mockPropertyUnitService.addDocumentToUnit.mockResolvedValue(expectedResult);

      await controller.addDocumentToUnit(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.addDocumentToUnit).toHaveBeenCalledWith(
        mockRequest.context,
        scannedFiles
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith(expectedResult);
    });

    it('should return bad request when no files uploaded', async () => {
      mockRequest.body = {};

      await controller.addDocumentToUnit(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.addDocumentToUnit).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'No document file uploaded'
      });
    });

    it('should return bad request when scannedFiles is empty', async () => {
      mockRequest.body = { scannedFiles: null };

      await controller.addDocumentToUnit(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.addDocumentToUnit).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'No document file uploaded'
      });
    });

    it('should handle document upload errors', async () => {
      const scannedFiles = [PropertyTestFactory.createUploadResult()];
      const errorResult = {
        success: false,
        message: 'Failed to process document'
      };

      mockRequest.body = { scannedFiles };
      mockPropertyUnitService.addDocumentToUnit.mockResolvedValue(errorResult);

      await controller.addDocumentToUnit(mockRequest as AppRequest, mockResponse as Response);

      expect(mockResponse.json).toHaveBeenCalledWith(errorResult);
    });
  });

  describe('deleteDocumentFromUnit', () => {
    it('should successfully delete document from unit', async () => {
      const expectedResult = {
        success: true,
        message: 'Document deleted successfully'
      };

      mockPropertyUnitService.deleteDocumentFromUnit.mockResolvedValue(expectedResult);

      await controller.deleteDocumentFromUnit(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.deleteDocumentFromUnit).toHaveBeenCalledWith(mockRequest.context);
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith(expectedResult);
    });

    it('should handle document not found', async () => {
      const errorResult = {
        success: false,
        message: 'Document not found'
      };

      mockPropertyUnitService.deleteDocumentFromUnit.mockResolvedValue(errorResult);

      await controller.deleteDocumentFromUnit(mockRequest as AppRequest, mockResponse as Response);

      expect(mockResponse.json).toHaveBeenCalledWith(errorResult);
    });

    it('should handle deletion errors', async () => {
      const errorResult = {
        success: false,
        message: 'Failed to delete document from storage'
      };

      mockPropertyUnitService.deleteDocumentFromUnit.mockResolvedValue(errorResult);

      await controller.deleteDocumentFromUnit(mockRequest as AppRequest, mockResponse as Response);

      expect(mockResponse.json).toHaveBeenCalledWith(errorResult);
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle service throwing errors in addUnit', async () => {
      const unitData = PropertyTestFactory.createPropertyUnit();
      mockRequest.body = unitData;
      
      mockPropertyUnitService.addPropertyUnit.mockRejectedValue(new Error('Service error'));

      await expect(
        controller.addUnit(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Service error');

      expect(mockPropertyUnitService.addPropertyUnit).toHaveBeenCalledWith(
        mockRequest.context,
        unitData
      );
    });

    it('should handle service throwing errors in getPropertyUnits', async () => {
      mockRequest.query = {};
      
      mockPropertyUnitService.getPropertyUnits.mockRejectedValue(new Error('Database error'));

      await expect(
        controller.getPropertyUnits(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Database error');
    });

    it('should handle missing context in requests', async () => {
      mockRequest.context = undefined;
      mockPropertyUnitService.getPropertyUnit.mockRejectedValue(new Error('Context required'));

      await expect(
        controller.getPropertyUnit(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Context required');

      expect(mockPropertyUnitService.getPropertyUnit).toHaveBeenCalledWith(undefined);
    });

    it('should handle concurrent requests properly', async () => {
      const unitData1 = PropertyTestFactory.createPropertyUnit({ unitNumber: 'A-1001' });
      const unitData2 = PropertyTestFactory.createPropertyUnit({ unitNumber: 'A-1002' });
      
      const request1 = { ...mockRequest, body: unitData1 };
      const request2 = { ...mockRequest, body: unitData2 };

      mockPropertyUnitService.addPropertyUnit
        .mockResolvedValueOnce({ success: true, data: unitData1 })
        .mockResolvedValueOnce({ success: true, data: unitData2 });

      const [result1, result2] = await Promise.all([
        controller.addUnit(request1 as AppRequest, mockResponse as Response),
        controller.addUnit(request2 as AppRequest, mockResponse as Response)
      ]);

      expect(mockPropertyUnitService.addPropertyUnit).toHaveBeenCalledTimes(2);
      expect(mockPropertyUnitService.addPropertyUnit).toHaveBeenNthCalledWith(1, mockRequest.context, unitData1);
      expect(mockPropertyUnitService.addPropertyUnit).toHaveBeenNthCalledWith(2, mockRequest.context, unitData2);
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete unit lifecycle', async () => {
      const unitData = PropertyTestFactory.createPropertyUnit();
      
      // Add unit
      mockPropertyUnitService.addPropertyUnit.mockResolvedValue({
        success: true,
        data: { ...unitData, _id: 'unit123' }
      });

      await controller.addUnit(
        { ...mockRequest, body: unitData } as AppRequest,
        mockResponse as Response
      );

      // Update unit
      const updateData = { status: 'occupied' };
      mockPropertyUnitService.updateUnitStatus.mockResolvedValue({
        success: true,
        data: { ...unitData, status: 'occupied' }
      });

      await controller.updateUnitStatus(
        { ...mockRequest, body: updateData } as AppRequest,
        mockResponse as Response
      );

      // Archive unit
      mockPropertyUnitService.archiveUnit.mockResolvedValue({
        success: true,
        message: 'Unit archived'
      });

      await controller.archiveUnit(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.addPropertyUnit).toHaveBeenCalledWith(mockRequest.context, unitData);
      expect(mockPropertyUnitService.updateUnitStatus).toHaveBeenCalledWith(mockRequest.context, updateData);
      expect(mockPropertyUnitService.archiveUnit).toHaveBeenCalledWith(mockRequest.context);
    });

    it('should handle document management workflow', async () => {
      const uploadFiles = [PropertyTestFactory.createUploadResult()];

      // Add document
      mockPropertyUnitService.addDocumentToUnit.mockResolvedValue({
        success: true,
        data: { documents: uploadFiles }
      });

      await controller.addDocumentToUnit(
        { ...mockRequest, body: { scannedFiles: uploadFiles } } as AppRequest,
        mockResponse as Response
      );

      // Delete document
      mockPropertyUnitService.deleteDocumentFromUnit.mockResolvedValue({
        success: true,
        message: 'Document deleted'
      });

      await controller.deleteDocumentFromUnit(mockRequest as AppRequest, mockResponse as Response);

      expect(mockPropertyUnitService.addDocumentToUnit).toHaveBeenCalledWith(mockRequest.context, uploadFiles);
      expect(mockPropertyUnitService.deleteDocumentFromUnit).toHaveBeenCalledWith(mockRequest.context);
    });
  });
});