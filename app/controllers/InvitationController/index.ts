import { t } from '@shared/languages';
import { Response, Request } from 'express';
import { AppRequest } from '@interfaces/utils.interface';
import { httpStatusCodes, setAuthCookies } from '@utils/index';
import { InvitationService, AuthService } from '@services/index';

interface IConstructor {
  invitationService: InvitationService;
  authService: AuthService;
}

export class InvitationController {
  private readonly invitationService: InvitationService;
  private readonly authService: AuthService;

  constructor({ invitationService, authService }: IConstructor) {
    this.invitationService = invitationService;
    this.authService = authService;
  }

  sendInvitation = async (req: AppRequest, res: Response) => {
    const { currentuser } = req.context;
    const { clientId } = req.params;
    const invitationData = req.body;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('auth.errors.unauthorized'),
      });
    }

    const result = await this.invitationService.sendInvitation(
      currentuser.sub,
      clientId,
      invitationData
    );

    res.status(httpStatusCodes.OK).json({
      success: result.success,
      message: result.message,
      data: {
        invitationId: result.data.invitation.invitationId,
        inviteeEmail: result.data.invitation.inviteeEmail,
        role: result.data.invitation.role,
        status: result.data.invitation.status,
        expiresAt: result.data.invitation.expiresAt,
      },
    });
  };

  validateInvitation = async (req: Request, res: Response) => {
    const { token } = req.params;
    const result = await this.invitationService.validateInvitation(token);

    res.status(httpStatusCodes.OK).json({
      success: result.success,
      message: result.message,
      data: {
        invitationId: result.data.invitationId,
        inviteeEmail: result.data.inviteeEmail,
        inviteeFullName: result.data.inviteeFullName,
        role: result.data.role,
        status: result.data.status,
        expiresAt: result.data.expiresAt,
        clientId: result.data.clientId,
        personalInfo: result.data.personalInfo,
        metadata: result.data.metadata,
      },
    });
  };

  acceptInvitation = async (req: Request, res: Response) => {
    const { token } = req.params;
    const userData = req.body;

    const acceptanceData = {
      invitationToken: token,
      userData,
    };

    const result = await this.invitationService.acceptInvitation(acceptanceData);

    // auto-login the user after successful invitation acceptance
    const loginResult = await this.authService.loginAfterInvitationSignup(
      result.data.user._id.toString(),
      result.data.invitation.clientId
    );

    res = setAuthCookies(
      {
        accessToken: loginResult.data.accessToken,
        refreshToken: loginResult.data.refreshToken,
        rememberMe: false,
      },
      res
    );

    res.status(httpStatusCodes.OK).json({
      success: true,
      message: result.message,
      data: {
        user: {
          id: result.data.user._id,
          email: result.data.user.email,
          isActive: result.data.user.isActive,
        },
        activeAccount: loginResult.data.activeAccount,
        accounts: loginResult.data.accounts,
      },
    });
  };

  revokeInvitation = async (req: AppRequest, res: Response) => {
    const { currentuser } = req.context;
    const { invitationId } = req.params;
    const { reason } = req.body;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('auth.errors.unauthorized'),
      });
    }

    const result = await this.invitationService.revokeInvitation(
      invitationId,
      currentuser.sub,
      reason
    );

    res.status(httpStatusCodes.OK).json({
      success: result.success,
      message: result.message,
      data: {
        invitationId: result.data.invitationId,
        status: result.data.status,
        revokedAt: result.data.revokedAt,
        revokeReason: result.data.revokeReason,
      },
    });
  };

  resendInvitation = async (req: AppRequest, res: Response) => {
    const { currentuser } = req.context;
    const { invitationId } = req.params;
    const { customMessage } = req.body;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('auth.errors.unauthorized'),
      });
    }

    const result = await this.invitationService.resendInvitation(
      { invitationId, customMessage },
      currentuser.sub
    );

    res.status(httpStatusCodes.OK).json({
      success: result.success,
      message: result.message,
      data: {
        invitationId: result.data.invitation.invitationId,
        remindersSent: result.data.invitation.metadata.remindersSent,
        lastReminderSent: result.data.invitation.metadata.lastReminderSent,
      },
    });
  };

  getInvitations = async (req: AppRequest, res: Response) => {
    const { currentuser } = req.context;
    const { clientId } = req.params;
    const { status, role, page, limit, sortBy, sortOrder } = req.query;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('auth.errors.unauthorized'),
      });
    }

    const query = {
      clientId,
      status: status as any,
      role: role as any,
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      sortBy: sortBy as any,
      sortOrder: sortOrder as any,
    };

    const result = await this.invitationService.getInvitations(query, currentuser.sub);

    res.status(httpStatusCodes.OK).json({
      success: result.success,
      message: result.message,
      data: result.data.items,
      pagination: result.data.pagination,
    });
  };

  getInvitationStats = async (req: AppRequest, res: Response) => {
    const { currentuser } = req.context;
    const { clientId } = req.params;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('auth.errors.unauthorized'),
      });
    }

    const result = await this.invitationService.getInvitationStats(clientId, currentuser.sub);

    res.status(httpStatusCodes.OK).json({
      success: result.success,
      message: result.message,
      data: result.data,
    });
  };

  getInvitationById = async (req: AppRequest, res: Response) => {
    const { currentuser } = req.context;
    const { invitationId } = req.params;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('auth.errors.unauthorized'),
      });
    }

    // First validate that the invitation exists and user has access
    // We'll implement this by getting the invitation and checking permissions
    const result = await this.invitationService.validateInvitation(invitationId);

    // Check if user has access to the client
    await this.invitationService.getInvitationStats(result.data.clientId, currentuser.sub);

    res.status(httpStatusCodes.OK).json({
      success: result.success,
      message: result.message,
      data: result.data,
    });
  };

  getInvitationsByEmail = async (req: AppRequest, res: Response) => {
    const { currentuser } = req.context;
    const { email } = req.params;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('auth.errors.unauthorized'),
      });
    }

    // Only allow users to view their own invitations or if they're admin
    const user = await this.authService.getCurrentUser(currentuser.sub);
    if (user.data.email !== email) {
      // Check if user is an admin in any client - simplified check
      const hasAdminRole = currentuser.client.role === 'admin';
      if (!hasAdminRole) {
        return res.status(httpStatusCodes.FORBIDDEN).json({
          success: false,
          message: t('auth.errors.forbidden'),
        });
      }
    }

    // This would need to be implemented in the invitation service
    // For now, return a placeholder response
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Feature coming soon',
      data: [],
    });
  };
}
