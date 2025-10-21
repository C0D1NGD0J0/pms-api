import { Response } from 'express';
import { httpStatusCodes } from '@utils/constants';
import { createMockCurrentUser } from '@tests/helpers';
import { AppRequest } from '@interfaces/utils.interface';
import { UserService } from '@services/user/user.service';
import { ROLES } from '@shared/constants/roles.constants';
import { UserController } from '@controllers/UserController';
import { ProfileService } from '@services/profile/profile.service';
import { MediaUploadService } from '@services/mediaUpload/mediaUpload.service';

describe('UserController', () => {
  let userController: UserController;
  let mockUserService: jest.Mocked<UserService>;
  let mockProfileService: jest.Mocked<ProfileService>;
  let mockMediaUploadService: jest.Mocked<MediaUploadService>;
  let mockRequest: Partial<AppRequest>;
  let mockResponse: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    // Create mock services
    mockUserService = {
      getClientUserInfo: jest.fn(),
      getUsersByRole: jest.fn(),
      getFilteredUsers: jest.fn(),
      getUserStats: jest.fn(),
    } as any;

    mockProfileService = {
      getUserProfileForEdit: jest.fn(),
      updateUserProfile: jest.fn(),
      getUserNotificationPreferences: jest.fn(),
    } as any;

    mockMediaUploadService = {
      handleFiles: jest.fn(),
    } as any;

    // Create mock response
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnThis();

    mockResponse = {
      status: statusMock,
      json: jsonMock,
    };

    // Create controller instance
    userController = new UserController({
      userService: mockUserService,
      profileService: mockProfileService,
      mediaUploadService: mockMediaUploadService,
    });

    // Reset request with default context
    const mockCurrentUser = createMockCurrentUser({
      sub: 'user-123',
      cuid: 'client-123',
    });

    mockRequest = {
      params: {},
      query: {},
      body: {},
      context: {
        currentuser: mockCurrentUser,
      },
    } as AppRequest;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /users/:cuid/:uid', () => {
    it('should get user info successfully', async () => {
      // Arrange
      const cuid = 'client-123';
      const uid = 'user-456';

      mockRequest.params = { cuid, uid };

      const mockUserInfo = {
        success: true,
        data: {
          uid,
          email: 'user@example.com',
          profile: {
            firstName: 'John',
            lastName: 'Doe',
          },
          roles: [ROLES.EMPLOYEE],
        },
      };

      mockUserService.getClientUserInfo.mockResolvedValue(mockUserInfo);

      // Act
      await userController.getClientUserInfo(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(mockUserService.getClientUserInfo).toHaveBeenCalledWith(
        cuid,
        uid,
        mockRequest.context?.currentuser
      );
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith(mockUserInfo);
    });

    it('should return 404 for user not found', async () => {
      // Arrange
      mockRequest.params = { cuid: 'client-123', uid: 'nonexistent' };

      const error = new Error('User not found');
      (error as any).statusCode = 404;
      mockUserService.getClientUserInfo.mockRejectedValue(error);

      // Act & Assert
      await expect(
        userController.getClientUserInfo(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('User not found');
    });

    it('should return 403 for permission denied', async () => {
      // Arrange
      mockRequest.params = { cuid: 'client-123', uid: 'unauthorized-user' };

      const error = new Error('Permission denied');
      (error as any).statusCode = 403;
      mockUserService.getClientUserInfo.mockRejectedValue(error);

      // Act & Assert
      await expect(
        userController.getClientUserInfo(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Permission denied');
    });

    it('should return 400 for invalid CUID format', async () => {
      // Arrange
      mockRequest.params = { cuid: 'invalid-format', uid: 'user-123' };

      const error = new Error('Invalid CUID format');
      (error as any).statusCode = 400;
      mockUserService.getClientUserInfo.mockRejectedValue(error);

      // Act & Assert
      await expect(
        userController.getClientUserInfo(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Invalid CUID format');
    });

    it('should validate response structure', async () => {
      // Arrange
      mockRequest.params = { cuid: 'client-123', uid: 'user-456' };

      const mockUserInfo = {
        success: true,
        data: {
          uid: 'user-456',
          email: 'user@example.com',
          profile: {
            firstName: 'John',
            lastName: 'Doe',
          },
          roles: [ROLES.EMPLOYEE],
          employeeInfo: {
            department: 'Engineering',
            position: 'Developer',
          },
        },
      };

      mockUserService.getClientUserInfo.mockResolvedValue(mockUserInfo);

      // Act
      await userController.getClientUserInfo(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      const response = jsonMock.mock.calls[0][0];
      expect(response).toHaveProperty('success', true);
      expect(response).toHaveProperty('data');
      expect(response.data).toHaveProperty('uid');
      expect(response.data).toHaveProperty('profile');
    });
  });

  describe('GET /users/:cuid/role/:role', () => {
    it('should get users by role with pagination', async () => {
      // Arrange
      mockRequest.params = { role: ROLES.EMPLOYEE };

      const mockResult = {
        success: true,
        data: {
          users: [
            { uid: 'user-1', email: 'user1@example.com' },
            { uid: 'user-2', email: 'user2@example.com' },
          ],
          pagination: {
            page: 1,
            limit: 10,
            total: 2,
          },
        },
      };

      mockUserService.getUsersByRole.mockResolvedValue(mockResult);

      // Act
      await userController.getUsersByRole(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(mockUserService.getUsersByRole).toHaveBeenCalledWith(
        mockRequest.context,
        ROLES.EMPLOYEE
      );
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith(mockResult);
    });

    it('should return 400 for invalid role', async () => {
      // Arrange
      mockRequest.params = { role: 'INVALID_ROLE' };

      const error = new Error('Invalid role');
      (error as any).statusCode = 400;
      mockUserService.getUsersByRole.mockRejectedValue(error);

      // Act & Assert
      await expect(
        userController.getUsersByRole(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Invalid role');
    });

    it('should return empty results for role with no users', async () => {
      // Arrange
      mockRequest.params = { role: ROLES.ADMIN };

      const mockResult = {
        success: true,
        data: {
          users: [],
          pagination: {
            page: 1,
            limit: 10,
            total: 0,
          },
        },
      };

      mockUserService.getUsersByRole.mockResolvedValue(mockResult);

      // Act
      await userController.getUsersByRole(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(jsonMock).toHaveBeenCalledWith(mockResult);
      expect(mockResult.data.users).toHaveLength(0);
    });

    it('should handle multiple roles filter', async () => {
      // Arrange
      mockRequest.params = { role: [ROLES.EMPLOYEE, ROLES.MANAGER] };

      const mockResult = {
        success: true,
        data: {
          users: [{ uid: 'user-1' }, { uid: 'user-2' }],
          pagination: { page: 1, limit: 10, total: 2 },
        },
      };

      mockUserService.getUsersByRole.mockResolvedValue(mockResult);

      // Act
      await userController.getUsersByRole(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(mockUserService.getUsersByRole).toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
    });

    it('should check permissions before returning users', async () => {
      // Arrange
      mockRequest.params = { role: ROLES.EMPLOYEE };

      const error = new Error('Insufficient permissions');
      (error as any).statusCode = 403;
      mockUserService.getUsersByRole.mockRejectedValue(error);

      // Act & Assert
      await expect(
        userController.getUsersByRole(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Insufficient permissions');
    });
  });

  describe('GET /users/:cuid/filtered', () => {
    it('should filter users with complex criteria', async () => {
      // Arrange
      mockRequest.params = { cuid: 'client-123' };
      mockRequest.query = {
        role: ROLES.EMPLOYEE,
        department: 'Engineering',
        status: 'active',
        page: '1',
        limit: '20',
        sortBy: 'email',
        sort: 'asc',
      };

      const mockResult = {
        success: true,
        data: {
          users: [
            { uid: 'user-1', email: 'a@example.com' },
            { uid: 'user-2', email: 'b@example.com' },
          ],
          pagination: {
            page: 1,
            limit: 20,
            total: 2,
          },
        },
      };

      mockUserService.getFilteredUsers.mockResolvedValue(mockResult);

      // Act
      await userController.getFilteredUsers(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(mockUserService.getFilteredUsers).toHaveBeenCalledWith(
        'client-123',
        {
          role: ROLES.EMPLOYEE,
          department: 'Engineering',
          status: 'active',
        },
        {
          page: 1,
          limit: 20,
          sortBy: 'email',
          sort: 'asc',
          skip: 0,
        }
      );
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
    });

    it('should apply default pagination when not provided', async () => {
      // Arrange
      mockRequest.params = { cuid: 'client-123' };
      mockRequest.query = {};

      const mockResult = {
        success: true,
        data: { users: [], pagination: { page: 1, limit: 10, total: 0 } },
      };

      mockUserService.getFilteredUsers.mockResolvedValue(mockResult);

      // Act
      await userController.getFilteredUsers(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(mockUserService.getFilteredUsers).toHaveBeenCalledWith(
        'client-123',
        {
          role: undefined,
          department: undefined,
          status: undefined,
        },
        {
          page: 1,
          limit: 10,
          sortBy: undefined,
          sort: undefined,
          skip: 0,
        }
      );
    });

    it('should handle sort parameters correctly', async () => {
      // Arrange
      mockRequest.params = { cuid: 'client-123' };
      mockRequest.query = {
        sortBy: 'createdAt',
        sort: 'desc',
      };

      const mockResult = {
        success: true,
        data: { users: [], pagination: {} },
      };

      mockUserService.getFilteredUsers.mockResolvedValue(mockResult);

      // Act
      await userController.getFilteredUsers(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      const callArgs = mockUserService.getFilteredUsers.mock.calls[0];
      expect(callArgs[2]).toMatchObject({
        sortBy: 'createdAt',
        sort: 'desc',
      });
    });

    it('should return all users when no filters applied', async () => {
      // Arrange
      mockRequest.params = { cuid: 'client-123' };
      mockRequest.query = {};

      const mockResult = {
        success: true,
        data: {
          users: [{ uid: 'user-1' }, { uid: 'user-2' }, { uid: 'user-3' }],
          pagination: { page: 1, limit: 10, total: 3 },
        },
      };

      mockUserService.getFilteredUsers.mockResolvedValue(mockResult);

      // Act
      await userController.getFilteredUsers(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(jsonMock).toHaveBeenCalledWith(mockResult);
      expect(mockResult.data.users).toHaveLength(3);
    });

    it('should return 400 for invalid filter values', async () => {
      // Arrange
      mockRequest.params = { cuid: 'client-123' };
      mockRequest.query = {
        status: 'invalid-status',
      };

      const error = new Error('Invalid status value');
      (error as any).statusCode = 400;
      mockUserService.getFilteredUsers.mockRejectedValue(error);

      // Act & Assert
      await expect(
        userController.getFilteredUsers(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Invalid status value');
    });
  });

  describe('GET /users/:cuid/stats', () => {
    it('should get stats for all roles', async () => {
      // Arrange
      mockRequest.params = { cuid: 'client-123' };
      mockRequest.query = {};

      const mockStats = {
        success: true,
        data: {
          total: 100,
          byRole: {
            [ROLES.EMPLOYEE]: 70,
            [ROLES.MANAGER]: 20,
            [ROLES.ADMIN]: 10,
          },
          byStatus: {
            active: 95,
            inactive: 5,
          },
        },
      };

      mockUserService.getUserStats.mockResolvedValue(mockStats);

      // Act
      await userController.getUserStats(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(mockUserService.getUserStats).toHaveBeenCalledWith('client-123', {});
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith(mockStats);
    });

    it('should get stats filtered by role', async () => {
      // Arrange
      mockRequest.params = { cuid: 'client-123' };
      mockRequest.query = { role: ROLES.EMPLOYEE };

      const mockStats = {
        success: true,
        data: {
          total: 70,
          byDepartment: {
            Engineering: 40,
            Sales: 30,
          },
        },
      };

      mockUserService.getUserStats.mockResolvedValue(mockStats);

      // Act
      await userController.getUserStats(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(mockUserService.getUserStats).toHaveBeenCalledWith('client-123', {
        role: ROLES.EMPLOYEE,
      });
      expect(jsonMock).toHaveBeenCalledWith(mockStats);
    });

    it('should handle empty client gracefully', async () => {
      // Arrange
      mockRequest.params = { cuid: 'empty-client' };

      const mockStats = {
        success: true,
        data: {
          total: 0,
          byRole: {},
          byStatus: {},
        },
      };

      mockUserService.getUserStats.mockResolvedValue(mockStats);

      // Act
      await userController.getUserStats(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(jsonMock).toHaveBeenCalledWith(mockStats);
      expect(mockStats.data.total).toBe(0);
    });

    it('should validate response structure', async () => {
      // Arrange
      mockRequest.params = { cuid: 'client-123' };

      const mockStats = {
        success: true,
        data: {
          total: 50,
          byRole: { [ROLES.EMPLOYEE]: 50 },
        },
      };

      mockUserService.getUserStats.mockResolvedValue(mockStats);

      // Act
      await userController.getUserStats(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      const response = jsonMock.mock.calls[0][0];
      expect(response).toHaveProperty('success', true);
      expect(response).toHaveProperty('data');
      expect(response.data).toHaveProperty('total');
    });

    it('should check permissions before returning stats', async () => {
      // Arrange
      mockRequest.params = { cuid: 'client-123' };

      const error = new Error('Insufficient permissions');
      (error as any).statusCode = 403;
      mockUserService.getUserStats.mockRejectedValue(error);

      // Act & Assert
      await expect(
        userController.getUserStats(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Insufficient permissions');
    });
  });

  describe('GET /users/profile', () => {
    it('should get own profile successfully', async () => {
      // Arrange
      mockRequest.query = {};

      const mockProfile = {
        success: true,
        data: {
          uid: 'user-123',
          email: 'user@example.com',
          profile: {
            firstName: 'John',
            lastName: 'Doe',
          },
        },
      };

      mockProfileService.getUserProfileForEdit.mockResolvedValue(mockProfile);

      // Act
      await userController.getUserProfile(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(mockProfileService.getUserProfileForEdit).toHaveBeenCalledWith(
        mockRequest.context,
        undefined
      );
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith(mockProfile);
    });

    it('should allow manager to get employee profile', async () => {
      // Arrange
      const targetUid = 'employee-456';
      mockRequest.query = { uid: targetUid };

      const mockProfile = {
        success: true,
        data: {
          uid: targetUid,
          email: 'employee@example.com',
          profile: {
            firstName: 'Jane',
            lastName: 'Smith',
          },
        },
      };

      mockProfileService.getUserProfileForEdit.mockResolvedValue(mockProfile);

      // Act
      await userController.getUserProfile(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(mockProfileService.getUserProfileForEdit).toHaveBeenCalledWith(
        mockRequest.context,
        targetUid
      );
      expect(jsonMock).toHaveBeenCalledWith(mockProfile);
    });

    it('should return 404 for profile not found', async () => {
      // Arrange
      mockRequest.query = { uid: 'nonexistent' };

      const error = new Error('Profile not found');
      (error as any).statusCode = 404;
      mockProfileService.getUserProfileForEdit.mockRejectedValue(error);

      // Act & Assert
      await expect(
        userController.getUserProfile(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Profile not found');
    });

    it('should return 403 for cross-user access without permission', async () => {
      // Arrange
      mockRequest.query = { uid: 'other-user' };

      const error = new Error('Permission denied');
      (error as any).statusCode = 403;
      mockProfileService.getUserProfileForEdit.mockRejectedValue(error);

      // Act & Assert
      await expect(
        userController.getUserProfile(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Permission denied');
    });

    it('should handle query parameter correctly', async () => {
      // Arrange
      const targetUid = 'user-789';
      mockRequest.query = { uid: targetUid };

      const mockProfile = {
        success: true,
        data: { uid: targetUid },
      };

      mockProfileService.getUserProfileForEdit.mockResolvedValue(mockProfile);

      // Act
      await userController.getUserProfile(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(mockProfileService.getUserProfileForEdit).toHaveBeenCalledWith(
        mockRequest.context,
        targetUid
      );
    });
  });

  describe('PUT /users/profile', () => {
    it('should update profile successfully', async () => {
      // Arrange
      mockRequest.body = {
        personalInfo: {
          firstName: 'John',
          lastName: 'Doe Updated',
        },
      };

      mockMediaUploadService.handleFiles.mockResolvedValue({
        hasFiles: false,
        message: 'No files to process',
        processedFiles: [],
      });

      const mockUpdateResult = {
        success: true,
        message: 'Profile updated successfully',
        data: { uid: 'user-123' },
      };

      mockProfileService.updateUserProfile.mockResolvedValue(mockUpdateResult);

      // Act
      await userController.updateUserProfile(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(mockProfileService.updateUserProfile).toHaveBeenCalledWith(
        mockRequest.context,
        mockRequest.body
      );
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith(mockUpdateResult);
    });

    it('should handle profile update with avatar upload', async () => {
      // Arrange
      mockRequest.body = {
        personalInfo: {
          firstName: 'John',
        },
      };

      mockMediaUploadService.handleFiles.mockResolvedValue({
        hasFiles: true,
        message: 'Avatar uploaded successfully',
        processedFiles: [{ fieldName: 'avatar', s3Key: 'avatars/user-123.jpg' }],
      });

      const mockUpdateResult = {
        success: true,
        message: 'Profile updated',
        data: { uid: 'user-123' },
      };

      mockProfileService.updateUserProfile.mockResolvedValue(mockUpdateResult);

      // Act
      await userController.updateUserProfile(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(mockMediaUploadService.handleFiles).toHaveBeenCalled();
      expect(mockProfileService.updateUserProfile).toHaveBeenCalled();

      const response = jsonMock.mock.calls[0][0];
      expect(response).toHaveProperty('fileUpload', 'Avatar uploaded successfully');
      expect(response).toHaveProperty('processedFiles');
    });

    it('should return 400 for validation error', async () => {
      // Arrange
      mockRequest.body = {
        personalInfo: {
          email: 'invalid-email',
        },
      };

      mockMediaUploadService.handleFiles.mockResolvedValue({
        hasFiles: false,
        message: 'No files',
        processedFiles: [],
      });

      const error = new Error('Validation failed');
      (error as any).statusCode = 400;
      mockProfileService.updateUserProfile.mockRejectedValue(error);

      // Act & Assert
      await expect(
        userController.updateUserProfile(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Validation failed');
    });

    it('should return 403 for permission denied', async () => {
      // Arrange
      mockRequest.body = {
        personalInfo: { firstName: 'Test' },
      };

      mockMediaUploadService.handleFiles.mockResolvedValue({
        hasFiles: false,
        message: 'No files',
        processedFiles: [],
      });

      const error = new Error('Cannot update other user profile');
      (error as any).statusCode = 403;
      mockProfileService.updateUserProfile.mockRejectedValue(error);

      // Act & Assert
      await expect(
        userController.updateUserProfile(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Cannot update other user profile');
    });

    it('should integrate media handling correctly', async () => {
      // Arrange
      mockRequest.body = { personalInfo: {} };
      const mockCurrentUser = mockRequest.context?.currentuser;

      mockMediaUploadService.handleFiles.mockResolvedValue({
        hasFiles: true,
        message: 'Files processed',
        processedFiles: [{ fieldName: 'avatar' }],
      });

      mockProfileService.updateUserProfile.mockResolvedValue({
        success: true,
        message: 'Updated',
        data: {},
      });

      // Act
      await userController.updateUserProfile(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(mockMediaUploadService.handleFiles).toHaveBeenCalledWith(mockRequest, {
        primaryResourceId: mockCurrentUser?.uid,
        uploadedBy: mockCurrentUser?.sub,
        resourceContext: expect.any(String),
      });
    });
  });
});
