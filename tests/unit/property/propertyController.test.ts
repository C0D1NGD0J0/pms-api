import { Response } from 'express';
import { httpStatusCodes } from '@utils/constants';
import { ResourceContext } from '@interfaces/utils.interface';
import { PropertyController } from '@controllers/PropertyController';
import {
  createMockRequestContext,
  createMockCurrentUser,
  createMockProperty,
} from '@tests/helpers';

const createMockServices = () => ({
  propertyService: {
    addProperty: jest.fn(),
    updateClientProperty: jest.fn(),
    getClientProperty: jest.fn(),
    getClientProperties: jest.fn(),
    archiveClientProperty: jest.fn(),
    validateCsv: jest.fn(),
    addPropertiesFromCsv: jest.fn(),
    getPendingApprovals: jest.fn(),
    approveProperty: jest.fn(),
    rejectProperty: jest.fn(),
    bulkApproveProperties: jest.fn(),
    bulkRejectProperties: jest.fn(),
    getMyPropertyRequests: jest.fn(),
    getAssignableUsers: jest.fn(),
  },
  mediaUploadService: {
    handleFiles: jest.fn(),
  },
});

describe('PropertyController', () => {
  let propertyController: PropertyController;
  let mockServices: ReturnType<typeof createMockServices>;
  let mockRequest: any;
  let mockResponse: Response;

  const createMockRequest = (overrides = {}) => ({
    context: createMockRequestContext({
      currentuser: createMockCurrentUser(),
      request: { params: { cuid: 'test-cuid', pid: 'test-pid' } },
    }),
    params: { cuid: 'test-cuid', pid: 'test-pid' },
    body: { name: 'Test Property' },
    query: {},
    ...overrides,
  });

  const createMockResponse = (): Response => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as Response);

  beforeEach(() => {
    mockServices = createMockServices();
    mockRequest = createMockRequest();
    mockResponse = createMockResponse();

    propertyController = new PropertyController({
      propertyService: mockServices.propertyService as any,
      mediaUploadService: mockServices.mediaUploadService as any,
    });

    jest.clearAllMocks();
  });

  describe('create', () => {
    const mockPropertyData = { success: true, data: { id: 'prop-123', name: 'Test Property' } };
    const mockUploadResult = {
      hasFiles: true,
      message: '2 file(s) queued for processing',
      processedFiles: { documents: { queuedCount: 2, message: '2 files queued' } },
      totalQueued: 2,
    };

    it('should create property and handle file uploads successfully', async () => {
      mockServices.propertyService.addProperty.mockResolvedValue(mockPropertyData);
      mockServices.mediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);

      await propertyController.create(mockRequest, mockResponse);

      expect(mockServices.propertyService.addProperty).toHaveBeenCalledWith(
        mockRequest.context,
        mockRequest.body
      );

      expect(mockServices.mediaUploadService.handleFiles).toHaveBeenCalledWith(mockRequest, {
        primaryResourceId: 'prop-123',
        uploadedBy: mockRequest.context.currentuser.sub,
        resourceContext: ResourceContext.PROPERTY,
      });

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith({
        ...mockPropertyData,
        fileUpload: mockUploadResult.message,
        processedFiles: mockUploadResult.processedFiles,
      });
    });

    it('should create property without file uploads', async () => {
      // Arrange
      const mockProperty = { success: true, data: { id: 'prop-123', name: 'Test Property' } };
      const mockUploadResult = {
        hasFiles: false,
        message: 'No files to process',
        processedFiles: {},
        totalQueued: 0,
      };

      mockServices.propertyService.addProperty.mockResolvedValue(mockProperty);
      mockServices.mediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);

      // Act
      await propertyController.create(mockRequest, mockResponse);

      // Assert
      expect(mockServices.mediaUploadService.handleFiles).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalledWith(mockProperty);
    });

    it('should handle property creation error', async () => {
      // Arrange
      const error = new Error('Property creation failed');
      mockServices.propertyService.addProperty.mockRejectedValue(error);

      // Act & Assert
      await expect(propertyController.create(mockRequest, mockResponse)).rejects.toThrow(
        'Property creation failed'
      );
      expect(mockServices.mediaUploadService.handleFiles).not.toHaveBeenCalled();
    });

    it('should handle file upload error during creation', async () => {
      // Arrange
      const mockProperty = { success: true, data: { id: 'prop-123', name: 'Test Property' } };
      const uploadError = new Error('File upload failed');

      mockServices.propertyService.addProperty.mockResolvedValue(mockProperty);
      mockServices.mediaUploadService.handleFiles.mockRejectedValue(uploadError);

      // Act & Assert
      await expect(propertyController.create(mockRequest, mockResponse)).rejects.toThrow(
        'File upload failed'
      );
    });
  });

  describe('updateClientProperty', () => {
    it('should update property and handle file uploads successfully', async () => {
      // Arrange
      const mockUpdateResult = {
        success: true,
        data: { id: 'prop-123', name: 'Updated Property' },
      };
      const mockUploadResult = {
        hasFiles: true,
        message: '1 file(s) queued for processing',
        processedFiles: { documents: { queuedCount: 1, message: '1 file queued' } },
        totalQueued: 1,
      };

      mockServices.mediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);
      mockServices.propertyService.updateClientProperty.mockResolvedValue(mockUpdateResult);

      // Act
      await propertyController.updateClientProperty(mockRequest, mockResponse);

      // Assert
      expect(mockServices.mediaUploadService.handleFiles).toHaveBeenCalledWith(mockRequest, {
        primaryResourceId: 'test-pid',
        uploadedBy: mockRequest.context.currentuser.sub,
        resourceContext: ResourceContext.PROPERTY,
        hardDelete: false,
      });

      expect(mockServices.propertyService.updateClientProperty).toHaveBeenCalledWith(
        {
          cuid: 'test-cuid',
          pid: 'test-pid',
          currentuser: mockRequest.context.currentuser,
          hardDelete: false,
        },
        mockRequest.body
      );

      expect(mockResponse.json).toHaveBeenCalledWith({
        ...mockUpdateResult,
        fileUpload: mockUploadResult.message,
        processedFiles: mockUploadResult.processedFiles,
      });
    });

    it('should update property without file uploads', async () => {
      // Arrange
      const mockUpdateResult = {
        success: true,
        data: { id: 'prop-123', name: 'Updated Property' },
      };
      const mockUploadResult = {
        hasFiles: false,
        message: 'No files to process',
        processedFiles: {},
        totalQueued: 0,
      };

      mockServices.mediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);
      mockServices.propertyService.updateClientProperty.mockResolvedValue(mockUpdateResult);

      // Act
      await propertyController.updateClientProperty(mockRequest, mockResponse);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(mockUpdateResult);
    });

    it('should return unauthorized when user is not authenticated', async () => {
      // Arrange
      const requestWithoutUser = {
        ...mockRequest,
        context: { ...mockRequest.context, currentuser: null },
      };

      // Act
      await propertyController.updateClientProperty(requestWithoutUser, mockResponse);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.UNAUTHORIZED);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'User not authenticated',
      });
    });

    it('should handle file upload error during update', async () => {
      // Arrange
      const uploadError = new Error('Upload service error');
      mockServices.mediaUploadService.handleFiles.mockRejectedValue(uploadError);

      // Act & Assert
      await expect(
        propertyController.updateClientProperty(mockRequest, mockResponse)
      ).rejects.toThrow('Upload service error');
      expect(mockServices.propertyService.updateClientProperty).not.toHaveBeenCalled();
    });

    it('should handle property update error after successful file upload', async () => {
      // Arrange
      const mockUploadResult = { hasFiles: false, processedFiles: {}, totalQueued: 0 };
      const updateError = new Error('Property update failed');

      mockServices.mediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);
      mockServices.propertyService.updateClientProperty.mockRejectedValue(updateError);

      // Act & Assert
      await expect(
        propertyController.updateClientProperty(mockRequest, mockResponse)
      ).rejects.toThrow('Property update failed');
      expect(mockServices.mediaUploadService.handleFiles).toHaveBeenCalled();
    });
  });

  describe('existing methods should still work', () => {
    it('should get property successfully', async () => {
      // Arrange
      const mockProperty = createMockProperty();
      mockServices.propertyService.getClientProperty.mockResolvedValue({
        success: true,
        data: { property: mockProperty, unitInfo: {} },
      });

      // Act
      await propertyController.getProperty(mockRequest, mockResponse);

      // Assert
      expect(mockServices.propertyService.getClientProperty).toHaveBeenCalledWith(
        'test-cuid',
        'test-pid',
        mockRequest.context.currentuser
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
    });

    it('should get client properties successfully', async () => {
      // Arrange
      const mockProperties = [createMockProperty(), createMockProperty()];
      mockServices.propertyService.getClientProperties.mockResolvedValue({
        success: true,
        data: { items: mockProperties, pagination: {} },
      });

      const requestWithQuery = {
        ...mockRequest,
        query: { page: '1', limit: '10' },
      };

      // Act
      await propertyController.getClientProperties(requestWithQuery, mockResponse);

      // Assert
      expect(mockServices.propertyService.getClientProperties).toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
    });

    it('should archive property successfully', async () => {
      // Arrange
      mockServices.propertyService.archiveClientProperty.mockResolvedValue({
        success: true,
        data: null,
        message: 'Property archived successfully',
      });

      // Act
      await propertyController.archiveProperty(mockRequest, mockResponse);

      // Assert
      expect(mockServices.propertyService.archiveClientProperty).toHaveBeenCalledWith(
        'test-cuid',
        'test-pid',
        mockRequest.context.currentuser
      );
    });

    it('should validate CSV successfully', async () => {
      // Arrange
      const csvRequest = {
        ...mockRequest,
        body: {
          scannedFiles: [
            {
              originalFileName: 'test.csv',
              fieldName: 'csvFile',
              mimeType: 'text/csv',
              path: '/tmp/test.csv',
              filename: 'test.csv',
              fileSize: 1024,
              uploadedAt: new Date(),
              uploadedBy: 'user-123',
            },
          ],
        },
      };

      mockServices.propertyService.validateCsv.mockResolvedValue({
        success: true,
        data: { processId: 'job-123' },
      });

      // Act
      await propertyController.validateCsv(csvRequest, mockResponse);

      // Assert
      expect(mockServices.propertyService.validateCsv).toHaveBeenCalled();
    });

    it('should get pending approvals successfully', async () => {
      // Arrange
      const requestWithQuery = {
        ...mockRequest,
        query: { page: '1', limit: '10' },
      };

      mockServices.propertyService.getPendingApprovals.mockResolvedValue({
        success: true,
        data: { items: [], pagination: {} },
      });

      // Act
      await propertyController.getPendingApprovals(requestWithQuery, mockResponse);

      // Assert
      expect(mockServices.propertyService.getPendingApprovals).toHaveBeenCalled();
    });

    it('should approve property successfully', async () => {
      // Arrange
      const approveRequest = {
        ...mockRequest,
        body: { notes: 'Looks good' },
      };

      mockServices.propertyService.approveProperty.mockResolvedValue({
        success: true,
        data: createMockProperty(),
      });

      // Act
      await propertyController.approveProperty(approveRequest, mockResponse);

      // Assert
      expect(mockServices.propertyService.approveProperty).toHaveBeenCalledWith(
        'test-cuid',
        'test-pid',
        mockRequest.context.currentuser,
        'Looks good'
      );
    });
  });

  describe('error handling for authentication', () => {
    it('should handle missing authentication in various methods', async () => {
      const unauthenticatedRequest = {
        ...mockRequest,
        context: { ...mockRequest.context, currentuser: null },
      };

      const methodsToTest = [
        'getProperty',
        'archiveProperty',
        'getPendingApprovals',
        'approveProperty',
        'rejectProperty',
        'getMyPropertyRequests',
      ];

      for (const methodName of methodsToTest) {
        // Reset mocks
        jest.clearAllMocks();

        // Act
        await (propertyController as any)[methodName](unauthenticatedRequest, mockResponse);

        // Assert
        expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.UNAUTHORIZED);
        expect(mockResponse.json).toHaveBeenCalledWith({
          success: false,
          message: 'User not authenticated',
        });
      }
    });
  });

  describe('MediaUploadService integration', () => {
    it('should pass correct resource context for property uploads', async () => {
      // Arrange
      const mockProperty = { success: true, data: { id: 'prop-123' } };
      const mockUploadResult = { hasFiles: false, processedFiles: {}, totalQueued: 0 };

      mockServices.propertyService.addProperty.mockResolvedValue(mockProperty);
      mockServices.mediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);

      // Act
      await propertyController.create(mockRequest, mockResponse);

      // Assert
      expect(mockServices.mediaUploadService.handleFiles).toHaveBeenCalledWith(
        mockRequest,
        expect.objectContaining({
          resourceContext: ResourceContext.PROPERTY,
        })
      );
    });

    it('should use property ID as primaryResourceId in create method', async () => {
      // Arrange
      const propertyId = 'new-property-123';
      const mockProperty = { success: true, data: { id: propertyId } };
      const mockUploadResult = { hasFiles: false, processedFiles: {}, totalQueued: 0 };

      mockServices.propertyService.addProperty.mockResolvedValue(mockProperty);
      mockServices.mediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);

      // Act
      await propertyController.create(mockRequest, mockResponse);

      // Assert
      expect(mockServices.mediaUploadService.handleFiles).toHaveBeenCalledWith(
        mockRequest,
        expect.objectContaining({
          primaryResourceId: propertyId,
        })
      );
    });

    it('should use PID from params as primaryResourceId in update method', async () => {
      // Arrange
      const mockUploadResult = { hasFiles: false, processedFiles: {}, totalQueued: 0 };
      const mockUpdateResult = { success: true, data: {} };

      mockServices.mediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);
      mockServices.propertyService.updateClientProperty.mockResolvedValue(mockUpdateResult);

      // Act
      await propertyController.updateClientProperty(mockRequest, mockResponse);

      // Assert
      expect(mockServices.mediaUploadService.handleFiles).toHaveBeenCalledWith(
        mockRequest,
        expect.objectContaining({
          primaryResourceId: 'test-pid',
        })
      );
    });

    it('should use current user as uploadedBy', async () => {
      // Arrange
      const mockProperty = { success: true, data: { id: 'prop-123' } };
      const mockUploadResult = { hasFiles: false, processedFiles: {}, totalQueued: 0 };

      mockServices.propertyService.addProperty.mockResolvedValue(mockProperty);
      mockServices.mediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);

      // Act
      await propertyController.create(mockRequest, mockResponse);

      // Assert
      expect(mockServices.mediaUploadService.handleFiles).toHaveBeenCalledWith(
        mockRequest,
        expect.objectContaining({
          uploadedBy: mockRequest.context.currentuser.sub,
        })
      );
    });
  });

  describe('response format consistency', () => {
    it('should maintain consistent response format with file uploads', async () => {
      // Arrange
      const mockProperty = {
        success: true,
        data: { id: 'prop-123' },
        message: 'Property created successfully',
      };
      const mockUploadResult = {
        hasFiles: true,
        message: 'Files uploaded',
        processedFiles: { documents: { queuedCount: 2 } },
        totalQueued: 2,
      };

      mockServices.propertyService.addProperty.mockResolvedValue(mockProperty);
      mockServices.mediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);

      // Act
      await propertyController.create(mockRequest, mockResponse);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: { id: 'prop-123' },
        message: 'Property created successfully',
        fileUpload: 'Files uploaded',
        processedFiles: { documents: { queuedCount: 2 } },
      });
    });

    it('should not add file upload fields when no files processed', async () => {
      // Arrange
      const mockProperty = {
        success: true,
        data: { id: 'prop-123' },
        message: 'Property created successfully',
      };
      const mockUploadResult = {
        hasFiles: false,
        message: 'No files to process',
        processedFiles: {},
        totalQueued: 0,
      };

      mockServices.propertyService.addProperty.mockResolvedValue(mockProperty);
      mockServices.mediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);

      // Act
      await propertyController.create(mockRequest, mockResponse);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(mockProperty);
      // Verify no file upload fields are added
      const responseCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(responseCall.fileUpload).toBeUndefined();
      expect(responseCall.processedFiles).toBeUndefined();
    });
  });
});
