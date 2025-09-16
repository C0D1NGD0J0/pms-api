import { Response } from 'express';
import { httpStatusCodes } from '@utils/constants';
import { ResourceContext } from '@interfaces/utils.interface';
import { PropertyController } from '@controllers/PropertyController';
import {
  createMockRequestContext,
  createMockCurrentUser,
  createMockProperty,
} from '@tests/helpers';

// Mock the services
const mockPropertyService = {
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
};

const mockMediaUploadService = {
  handleFiles: jest.fn(),
};

const mockRequest = {
  context: createMockRequestContext({
    currentuser: createMockCurrentUser(),
    request: { params: { cuid: 'test-cuid', pid: 'test-pid' } },
  }),
  params: { cuid: 'test-cuid', pid: 'test-pid' },
  body: { name: 'Test Property' },
  query: {},
} as any;

const mockResponse = {
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
} as unknown as Response;

describe('PropertyController', () => {
  let propertyController: PropertyController;

  beforeEach(() => {
    propertyController = new PropertyController({
      propertyService: mockPropertyService as any,
      mediaUploadService: mockMediaUploadService as any,
    });

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create property and handle file uploads successfully', async () => {
      // Arrange
      const mockProperty = { success: true, data: { id: 'prop-123', name: 'Test Property' } };
      const mockUploadResult = {
        hasFiles: true,
        message: '2 file(s) queued for processing',
        processedFiles: { documents: { queuedCount: 2, message: '2 files queued' } },
        totalQueued: 2,
      };

      mockPropertyService.addProperty.mockResolvedValue(mockProperty);
      mockMediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);

      // Act
      await propertyController.create(mockRequest, mockResponse);

      // Assert
      expect(mockPropertyService.addProperty).toHaveBeenCalledWith(
        mockRequest.context,
        mockRequest.body
      );

      expect(mockMediaUploadService.handleFiles).toHaveBeenCalledWith(mockRequest, {
        primaryResourceId: 'prop-123',
        uploadedBy: mockRequest.context.currentuser.sub,
        resourceContext: ResourceContext.PROPERTY,
      });

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith({
        ...mockProperty,
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

      mockPropertyService.addProperty.mockResolvedValue(mockProperty);
      mockMediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);

      // Act
      await propertyController.create(mockRequest, mockResponse);

      // Assert
      expect(mockMediaUploadService.handleFiles).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalledWith(mockProperty);
    });

    it('should handle property creation error', async () => {
      // Arrange
      const error = new Error('Property creation failed');
      mockPropertyService.addProperty.mockRejectedValue(error);

      // Act & Assert
      await expect(propertyController.create(mockRequest, mockResponse)).rejects.toThrow(
        'Property creation failed'
      );
      expect(mockMediaUploadService.handleFiles).not.toHaveBeenCalled();
    });

    it('should handle file upload error during creation', async () => {
      // Arrange
      const mockProperty = { success: true, data: { id: 'prop-123', name: 'Test Property' } };
      const uploadError = new Error('File upload failed');

      mockPropertyService.addProperty.mockResolvedValue(mockProperty);
      mockMediaUploadService.handleFiles.mockRejectedValue(uploadError);

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

      mockMediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);
      mockPropertyService.updateClientProperty.mockResolvedValue(mockUpdateResult);

      // Act
      await propertyController.updateClientProperty(mockRequest, mockResponse);

      // Assert
      expect(mockMediaUploadService.handleFiles).toHaveBeenCalledWith(mockRequest, {
        primaryResourceId: 'test-pid',
        uploadedBy: mockRequest.context.currentuser.sub,
        resourceContext: ResourceContext.PROPERTY,
      });

      expect(mockPropertyService.updateClientProperty).toHaveBeenCalledWith(
        {
          cuid: 'test-cuid',
          pid: 'test-pid',
          currentuser: mockRequest.context.currentuser,
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

      mockMediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);
      mockPropertyService.updateClientProperty.mockResolvedValue(mockUpdateResult);

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
      mockMediaUploadService.handleFiles.mockRejectedValue(uploadError);

      // Act & Assert
      await expect(
        propertyController.updateClientProperty(mockRequest, mockResponse)
      ).rejects.toThrow('Upload service error');
      expect(mockPropertyService.updateClientProperty).not.toHaveBeenCalled();
    });

    it('should handle property update error after successful file upload', async () => {
      // Arrange
      const mockUploadResult = { hasFiles: false, processedFiles: {}, totalQueued: 0 };
      const updateError = new Error('Property update failed');

      mockMediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);
      mockPropertyService.updateClientProperty.mockRejectedValue(updateError);

      // Act & Assert
      await expect(
        propertyController.updateClientProperty(mockRequest, mockResponse)
      ).rejects.toThrow('Property update failed');
      expect(mockMediaUploadService.handleFiles).toHaveBeenCalled();
    });
  });

  describe('existing methods should still work', () => {
    it('should get property successfully', async () => {
      // Arrange
      const mockProperty = createMockProperty();
      mockPropertyService.getClientProperty.mockResolvedValue({
        success: true,
        data: { property: mockProperty, unitInfo: {} },
      });

      // Act
      await propertyController.getProperty(mockRequest, mockResponse);

      // Assert
      expect(mockPropertyService.getClientProperty).toHaveBeenCalledWith(
        'test-cuid',
        'test-pid',
        mockRequest.context.currentuser
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
    });

    it('should get client properties successfully', async () => {
      // Arrange
      const mockProperties = [createMockProperty(), createMockProperty()];
      mockPropertyService.getClientProperties.mockResolvedValue({
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
      expect(mockPropertyService.getClientProperties).toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
    });

    it('should archive property successfully', async () => {
      // Arrange
      mockPropertyService.archiveClientProperty.mockResolvedValue({
        success: true,
        data: null,
        message: 'Property archived successfully',
      });

      // Act
      await propertyController.archiveProperty(mockRequest, mockResponse);

      // Assert
      expect(mockPropertyService.archiveClientProperty).toHaveBeenCalledWith(
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

      mockPropertyService.validateCsv.mockResolvedValue({
        success: true,
        data: { processId: 'job-123' },
      });

      // Act
      await propertyController.validateCsv(csvRequest, mockResponse);

      // Assert
      expect(mockPropertyService.validateCsv).toHaveBeenCalled();
    });

    it('should get pending approvals successfully', async () => {
      // Arrange
      const requestWithQuery = {
        ...mockRequest,
        query: { page: '1', limit: '10' },
      };

      mockPropertyService.getPendingApprovals.mockResolvedValue({
        success: true,
        data: { items: [], pagination: {} },
      });

      // Act
      await propertyController.getPendingApprovals(requestWithQuery, mockResponse);

      // Assert
      expect(mockPropertyService.getPendingApprovals).toHaveBeenCalled();
    });

    it('should approve property successfully', async () => {
      // Arrange
      const approveRequest = {
        ...mockRequest,
        body: { notes: 'Looks good' },
      };

      mockPropertyService.approveProperty.mockResolvedValue({
        success: true,
        data: createMockProperty(),
      });

      // Act
      await propertyController.approveProperty(approveRequest, mockResponse);

      // Assert
      expect(mockPropertyService.approveProperty).toHaveBeenCalledWith(
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

      mockPropertyService.addProperty.mockResolvedValue(mockProperty);
      mockMediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);

      // Act
      await propertyController.create(mockRequest, mockResponse);

      // Assert
      expect(mockMediaUploadService.handleFiles).toHaveBeenCalledWith(
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

      mockPropertyService.addProperty.mockResolvedValue(mockProperty);
      mockMediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);

      // Act
      await propertyController.create(mockRequest, mockResponse);

      // Assert
      expect(mockMediaUploadService.handleFiles).toHaveBeenCalledWith(
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

      mockMediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);
      mockPropertyService.updateClientProperty.mockResolvedValue(mockUpdateResult);

      // Act
      await propertyController.updateClientProperty(mockRequest, mockResponse);

      // Assert
      expect(mockMediaUploadService.handleFiles).toHaveBeenCalledWith(
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

      mockPropertyService.addProperty.mockResolvedValue(mockProperty);
      mockMediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);

      // Act
      await propertyController.create(mockRequest, mockResponse);

      // Assert
      expect(mockMediaUploadService.handleFiles).toHaveBeenCalledWith(
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

      mockPropertyService.addProperty.mockResolvedValue(mockProperty);
      mockMediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);

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

      mockPropertyService.addProperty.mockResolvedValue(mockProperty);
      mockMediaUploadService.handleFiles.mockResolvedValue(mockUploadResult);

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
