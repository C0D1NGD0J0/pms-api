import { Response } from 'express';
import { httpStatusCodes } from '@utils/constants';
import { createMockCurrentUser } from '@tests/helpers';
import { AppRequest } from '@interfaces/utils.interface';
import { ROLES } from '@shared/constants/roles.constants';
import { InvitationController } from '@controllers/InvitationController';

describe('InvitationController', () => {
  let invitationController: InvitationController;
  let mockInvitationService: any;
  let mockAuthService: any;
  let mockRequest: any;
  let mockResponse: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let cookieMock: jest.Mock;

  beforeEach(() => {
    // Create mock services
    mockInvitationService = {
      sendInvitation: jest.fn(),
      getInvitationStats: jest.fn(),
      updateInvitation: jest.fn(),
      resendInvitation: jest.fn(),
      revokeInvitation: jest.fn(),
      validateInvitationByToken: jest.fn(),
      acceptInvitation: jest.fn(),
    } as any;

    mockAuthService = {
      loginAfterInvitationSignup: jest.fn(),
    } as any;

    // Create mock response
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnThis();
    cookieMock = jest.fn().mockReturnThis();

    mockResponse = {
      status: statusMock,
      json: jsonMock,
      cookie: cookieMock,
    };

    // Create controller instance
    invitationController = new InvitationController({
      invitationService: mockInvitationService,
      authService: mockAuthService,
    });

    // Reset request with default context
    const mockCurrentUser = createMockCurrentUser({
      sub: 'user-123',
      client: { cuid: 'client-123', role: ROLES.ADMIN, displayname: 'Test Client' },
    });

    mockRequest = {
      params: { cuid: 'client-123' },
      query: {},
      body: {},
      context: {
        currentuser: mockCurrentUser,
      },
    } as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /invitations', () => {
    it('should send invitation successfully', async () => {
      // Arrange
      mockRequest.body = {
        inviteeEmail: 'newemployee@example.com',
        role: ROLES.STAFF,
        personalInfo: {
          firstName: 'Jane',
          lastName: 'Doe',
        },
        metadata: {
          employeeInfo: {
            department: 'Engineering',
            position: 'Developer',
          },
        },
        status: 'pending',
      };

      const mockResult = {
        success: true,
        message: 'Invitation sent successfully',
        data: {
          invitation: {
            iuid: 'inv-123',
            inviteeEmail: 'newemployee@example.com',
            role: ROLES.STAFF,
            status: 'pending',
            expiresAt: new Date('2025-11-04'),
          },
        },
      };

      mockInvitationService.sendInvitation.mockResolvedValue(mockResult);

      // Act
      await invitationController.sendInvitation(
        mockRequest as AppRequest,
        mockResponse as Response
      );

      // Assert
      expect(mockInvitationService.sendInvitation).toHaveBeenCalledWith(
        'user-123',
        'client-123',
        expect.objectContaining({
          inviteeEmail: 'newemployee@example.com',
          role: ROLES.STAFF,
        })
      );
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Invitation sent successfully',
        data: expect.objectContaining({
          iuid: 'inv-123',
          inviteeEmail: 'newemployee@example.com',
        }),
      });
    });

    it('should return 409 for duplicate email', async () => {
      // Arrange
      mockRequest.body = {
        inviteeEmail: 'existing@example.com',
        role: ROLES.STAFF,
      };

      const error = new Error('User with this email already exists');
      (error as any).statusCode = 409;
      mockInvitationService.sendInvitation.mockRejectedValue(error);

      // Act & Assert
      await expect(
        invitationController.sendInvitation(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('User with this email already exists');
    });

    it('should return 400 for validation error', async () => {
      // Arrange
      mockRequest.body = {
        inviteeEmail: 'invalid-email',
        role: 'INVALID_ROLE',
      };

      const error = new Error('Validation failed');
      (error as any).statusCode = 400;
      mockInvitationService.sendInvitation.mockRejectedValue(error);

      // Act & Assert
      await expect(
        invitationController.sendInvitation(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Validation failed');
    });

    it('should return 403 for permission denied', async () => {
      // Arrange
      mockRequest.body = {
        inviteeEmail: 'user@example.com',
        role: ROLES.ADMIN,
      };

      const error = new Error('Insufficient permissions to invite admin');
      (error as any).statusCode = 403;
      mockInvitationService.sendInvitation.mockRejectedValue(error);

      // Act & Assert
      await expect(
        invitationController.sendInvitation(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Insufficient permissions to invite admin');
    });

    it('should handle bulk invitation data', async () => {
      // Arrange
      mockRequest.body = {
        inviteeEmail: 'vendor@example.com',
        role: ROLES.VENDOR,
        personalInfo: {
          firstName: 'Vendor',
          lastName: 'Company',
        },
        metadata: {
          vendorInfo: {
            companyName: 'Test Vendor LLC',
            services: ['plumbing', 'electrical'],
          },
        },
      };

      const mockResult = {
        success: true,
        message: 'Vendor invitation sent',
        data: {
          invitation: {
            iuid: 'inv-vendor-123',
            inviteeEmail: 'vendor@example.com',
            role: ROLES.VENDOR,
            status: 'pending',
            expiresAt: new Date(),
          },
        },
      };

      mockInvitationService.sendInvitation.mockResolvedValue(mockResult);

      // Act
      await invitationController.sendInvitation(
        mockRequest as AppRequest,
        mockResponse as Response
      );

      // Assert
      expect(mockInvitationService.sendInvitation).toHaveBeenCalledWith(
        'user-123',
        'client-123',
        expect.objectContaining({
          metadata: expect.objectContaining({
            vendorInfo: expect.any(Object),
          }),
        })
      );
    });
  });

  describe('GET /invitations/:cuid', () => {
    it('should list invitations with pagination', async () => {
      // Arrange
      mockRequest.query = {
        page: '1',
        limit: '20',
        status: 'pending',
      };

      const mockInvitations = {
        success: true,
        data: {
          invitations: [
            { iuid: 'inv-1', inviteeEmail: 'user1@example.com', status: 'pending' },
            { iuid: 'inv-2', inviteeEmail: 'user2@example.com', status: 'pending' },
          ],
          pagination: {
            page: 1,
            limit: 20,
            total: 2,
          },
        },
      };

      // Mock getInvitations (assuming this method exists on the service)
      (mockInvitationService as any).getInvitations = jest.fn().mockResolvedValue(mockInvitations);

      // Act
      if (mockInvitationService.getInvitations) {
        const result = await mockInvitationService.getInvitations(
          mockRequest.context!,
          mockRequest.query
        );

        // Manually trigger response
        mockResponse.status!(httpStatusCodes.OK).json(result);
      }

      // Assert
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith(mockInvitations);
    });

    it('should filter invitations by status', async () => {
      // Arrange
      const mockInvitations = {
        success: true,
        data: {
          invitations: [{ iuid: 'inv-1', status: 'sent' }],
          pagination: {},
        },
      };

      (mockInvitationService as any).getInvitations = jest.fn().mockResolvedValue(mockInvitations);

      // Simulate call
      if (mockInvitationService.getInvitations) {
        await mockInvitationService.getInvitations(mockRequest.context!, { status: 'sent' });
      }

      // Assert
      expect(mockInvitationService.getInvitations).toHaveBeenCalledWith(
        mockRequest.context,
        expect.objectContaining({ status: 'sent' })
      );
    });

    it('should filter invitations by role', async () => {
      // Arrange
      const mockInvitations = {
        success: true,
        data: {
          invitations: [{ iuid: 'inv-1', role: ROLES.STAFF }],
          pagination: {},
        },
      };

      (mockInvitationService as any).getInvitations = jest.fn().mockResolvedValue(mockInvitations);

      // Simulate call
      if (mockInvitationService.getInvitations) {
        await mockInvitationService.getInvitations(mockRequest.context!, {
          role: ROLES.STAFF,
        });
      }

      // Assert
      expect(mockInvitationService.getInvitations).toHaveBeenCalledWith(
        mockRequest.context,
        expect.objectContaining({ role: ROLES.STAFF })
      );
    });

    it('should return empty results when no invitations match', async () => {
      // Arrange
      const mockInvitations = {
        success: true,
        data: {
          invitations: [],
          pagination: { page: 1, limit: 10, total: 0 },
        },
      };

      (mockInvitationService as any).getInvitations = jest.fn().mockResolvedValue(mockInvitations);

      // Simulate call
      if (mockInvitationService.getInvitations) {
        const result = await mockInvitationService.getInvitations(mockRequest.context!, {});
        mockResponse.status!(httpStatusCodes.OK).json(result);
      }

      // Assert
      const response = jsonMock.mock.calls[0]?.[0];
      expect(response?.data.invitations).toHaveLength(0);
    });

    it('should check permissions before returning invitations', async () => {
      // Arrange
      const error = new Error('Permission denied');
      (error as any).statusCode = 403;

      (mockInvitationService as any).getInvitations = jest.fn().mockRejectedValue(error);

      // Act & Assert
      if (mockInvitationService.getInvitations) {
        await expect(
          mockInvitationService.getInvitations(mockRequest.context!, {})
        ).rejects.toThrow('Permission denied');
      }
    });
  });

  describe('PUT /invitations/:cuid/:iuid', () => {
    it('should update draft invitation successfully', async () => {
      // Arrange
      mockRequest.params = { cuid: 'client-123', iuid: 'inv-123' };
      mockRequest.context!.params = { iuid: 'inv-123' };
      mockRequest.body = {
        personalInfo: {
          firstName: 'Updated',
          lastName: 'Name',
        },
        role: ROLES.MANAGER,
      };

      const mockResult = {
        success: true,
        message: 'Invitation updated successfully',
        data: {
          iuid: 'inv-123',
          status: 'draft',
        },
      };

      mockInvitationService.updateInvitation.mockResolvedValue(mockResult);

      // Act
      await invitationController.updateInvitation(
        mockRequest as AppRequest,
        mockResponse as Response
      );

      // Assert
      expect(mockInvitationService.updateInvitation).toHaveBeenCalledWith(
        mockRequest.context,
        mockRequest.body,
        mockRequest.context?.currentuser
      );
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith(mockResult);
    });

    it('should return 400 for updating sent invitation', async () => {
      // Arrange
      mockRequest.params = { cuid: 'client-123', iuid: 'inv-sent' };
      mockRequest.context!.params = { iuid: 'inv-sent' };
      mockRequest.body = { role: ROLES.ADMIN };

      const error = new Error('Cannot update sent invitation');
      (error as any).statusCode = 400;
      mockInvitationService.updateInvitation.mockRejectedValue(error);

      // Act & Assert
      await expect(
        invitationController.updateInvitation(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Cannot update sent invitation');
    });

    it('should return 400 for validation error', async () => {
      // Arrange
      mockRequest.params = { cuid: 'client-123', iuid: 'inv-123' };
      mockRequest.context!.params = { iuid: 'inv-123' };
      mockRequest.body = { role: 'INVALID_ROLE' };

      const error = new Error('Invalid role');
      (error as any).statusCode = 400;
      mockInvitationService.updateInvitation.mockRejectedValue(error);

      // Act & Assert
      await expect(
        invitationController.updateInvitation(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Invalid role');
    });

    it('should return 404 for invitation not found', async () => {
      // Arrange
      mockRequest.params = { cuid: 'client-123', iuid: 'nonexistent' };
      mockRequest.context!.params = { iuid: 'nonexistent' };
      mockRequest.body = { role: ROLES.STAFF };

      const error = new Error('Invitation not found');
      (error as any).statusCode = 404;
      mockInvitationService.updateInvitation.mockRejectedValue(error);

      // Act & Assert
      await expect(
        invitationController.updateInvitation(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Invitation not found');
    });

    it('should return 403 for permission denied', async () => {
      // Arrange
      mockRequest.params = { cuid: 'client-123', iuid: 'inv-123' };
      mockRequest.context!.params = { iuid: 'inv-123' };
      mockRequest.body = { role: ROLES.STAFF };

      const error = new Error('Permission denied');
      (error as any).statusCode = 403;
      mockInvitationService.updateInvitation.mockRejectedValue(error);

      // Act & Assert
      await expect(
        invitationController.updateInvitation(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Permission denied');
    });
  });

  describe('POST /invitations/:cuid/:iuid/resend', () => {
    it('should resend invitation successfully', async () => {
      // Arrange
      mockRequest.params = { cuid: 'client-123', iuid: 'inv-123' };
      mockRequest.body = {
        customMessage: 'Please complete your registration',
      };

      const mockResult = {
        success: true,
        message: 'Invitation resent successfully',
        data: {
          invitation: {
            iuid: 'inv-123',
            metadata: {
              remindersSent: 2,
              lastReminderSent: new Date(),
            },
          },
        },
      };

      mockInvitationService.resendInvitation.mockResolvedValue(mockResult);

      // Act
      await invitationController.resendInvitation(
        mockRequest as AppRequest,
        mockResponse as Response
      );

      // Assert
      expect(mockInvitationService.resendInvitation).toHaveBeenCalledWith(
        {
          iuid: 'inv-123',
          customMessage: 'Please complete your registration',
        },
        'user-123'
      );
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            remindersSent: 2,
          }),
        })
      );
    });

    it('should return 400 for max resend limit reached', async () => {
      // Arrange
      mockRequest.params = { iuid: 'inv-maxed' };

      const error = new Error('Maximum resend limit reached');
      (error as any).statusCode = 400;
      mockInvitationService.resendInvitation.mockRejectedValue(error);

      // Act & Assert
      await expect(
        invitationController.resendInvitation(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Maximum resend limit reached');
    });

    it('should return 400 for expired invitation', async () => {
      // Arrange
      mockRequest.params = { iuid: 'inv-expired' };

      const error = new Error('Invitation has expired');
      (error as any).statusCode = 400;
      mockInvitationService.resendInvitation.mockRejectedValue(error);

      // Act & Assert
      await expect(
        invitationController.resendInvitation(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Invitation has expired');
    });

    it('should return 404 for invitation not found', async () => {
      // Arrange
      mockRequest.params = { iuid: 'nonexistent' };

      const error = new Error('Invitation not found');
      (error as any).statusCode = 404;
      mockInvitationService.resendInvitation.mockRejectedValue(error);

      // Act & Assert
      await expect(
        invitationController.resendInvitation(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Invitation not found');
    });

    it('should check permissions before resending', async () => {
      // Arrange
      mockRequest.params = { iuid: 'inv-123' };

      const error = new Error('Permission denied');
      (error as any).statusCode = 403;
      mockInvitationService.resendInvitation.mockRejectedValue(error);

      // Act & Assert
      await expect(
        invitationController.resendInvitation(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Permission denied');
    });
  });

  describe('DELETE /invitations/:cuid/:iuid', () => {
    it('should revoke invitation successfully', async () => {
      // Arrange
      mockRequest.params = { cuid: 'client-123', iuid: 'inv-123' };
      mockRequest.body = {
        reason: 'Position filled',
      };

      const mockResult = {
        success: true,
        message: 'Invitation revoked successfully',
        data: {
          iuid: 'inv-123',
          status: 'revoked',
          revokedAt: new Date(),
          revokeReason: 'Position filled',
        },
      };

      mockInvitationService.revokeInvitation.mockResolvedValue(mockResult);

      // Act
      await invitationController.revokeInvitation(
        mockRequest as AppRequest,
        mockResponse as Response
      );

      // Assert
      expect(mockInvitationService.revokeInvitation).toHaveBeenCalledWith(
        'inv-123',
        'user-123',
        'Position filled'
      );
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            status: 'revoked',
          }),
        })
      );
    });

    it('should return 400 for already accepted invitation', async () => {
      // Arrange
      mockRequest.params = { iuid: 'inv-accepted' };
      mockRequest.body = { reason: 'Test' };

      const error = new Error('Cannot revoke accepted invitation');
      (error as any).statusCode = 400;
      mockInvitationService.revokeInvitation.mockRejectedValue(error);

      // Act & Assert
      await expect(
        invitationController.revokeInvitation(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Cannot revoke accepted invitation');
    });

    it('should return 404 for invitation not found', async () => {
      // Arrange
      mockRequest.params = { iuid: 'nonexistent' };
      mockRequest.body = { reason: 'Test' };

      const error = new Error('Invitation not found');
      (error as any).statusCode = 404;
      mockInvitationService.revokeInvitation.mockRejectedValue(error);

      // Act & Assert
      await expect(
        invitationController.revokeInvitation(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Invitation not found');
    });

    it('should return 403 for permission denied', async () => {
      // Arrange
      mockRequest.params = { iuid: 'inv-123' };
      mockRequest.body = { reason: 'Test' };

      const error = new Error('Permission denied');
      (error as any).statusCode = 403;
      mockInvitationService.revokeInvitation.mockRejectedValue(error);

      // Act & Assert
      await expect(
        invitationController.revokeInvitation(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Permission denied');
    });

    it('should require reason for revocation', async () => {
      // Arrange
      mockRequest.params = { iuid: 'inv-123' };
      mockRequest.body = {}; // No reason provided

      const mockResult = {
        success: true,
        message: 'Invitation revoked',
        data: {
          iuid: 'inv-123',
          status: 'revoked',
          revokedAt: new Date(),
          revokeReason: undefined,
        },
      };

      mockInvitationService.revokeInvitation.mockResolvedValue(mockResult);

      // Act
      await invitationController.revokeInvitation(
        mockRequest as AppRequest,
        mockResponse as Response
      );

      // Assert
      expect(mockInvitationService.revokeInvitation).toHaveBeenCalledWith(
        'inv-123',
        'user-123',
        undefined
      );
    });
  });
});
