import { t } from '@shared/languages';
import { Response, Request } from 'express';
import { httpStatusCodes, setAuthCookies } from '@utils/index';
import { InvitationService, AuthService } from '@services/index';
import { ExtractedMediaFile, AppRequest } from '@interfaces/utils.interface';

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
    const { cuid } = req.params;
    const invitationData = req.body;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('auth.errors.unauthorized'),
      });
    }

    const result = await this.invitationService.sendInvitation(
      currentuser.sub,
      cuid,
      invitationData
    );

    res.status(httpStatusCodes.OK).json({
      success: result.success,
      message: result.message,
      data: {
        iuid: result.data.invitation.iuid,
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
        iuid: result.data.iuid,
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
    const { iuid } = req.params;
    const { reason } = req.body;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('auth.errors.unauthorized'),
      });
    }

    const result = await this.invitationService.revokeInvitation(iuid, currentuser.sub, reason);

    res.status(httpStatusCodes.OK).json({
      success: result.success,
      message: result.message,
      data: {
        iuid: result.data.iuid,
        status: result.data.status,
        revokedAt: result.data.revokedAt,
        revokeReason: result.data.revokeReason,
      },
    });
  };

  resendInvitation = async (req: AppRequest, res: Response) => {
    const { currentuser } = req.context;
    const { iuid } = req.params;
    const { customMessage } = req.body;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('auth.errors.unauthorized'),
      });
    }

    const result = await this.invitationService.resendInvitation(
      { iuid, customMessage },
      currentuser.sub
    );

    res.status(httpStatusCodes.OK).json({
      success: result.success,
      message: result.message,
      data: {
        iuid: result.data.invitation.iuid,
        remindersSent: result.data.invitation.metadata.remindersSent,
        lastReminderSent: result.data.invitation.metadata.lastReminderSent,
      },
    });
  };

  getInvitations = async (req: AppRequest, res: Response) => {
    const { currentuser } = req.context;
    const { cuid } = req.params;
    const { status, role, page, limit, sortBy, sortOrder } = req.query;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('auth.errors.unauthorized'),
      });
    }

    const query = {
      clientId: cuid,
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
    const { cuid } = req.params;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('auth.errors.unauthorized'),
      });
    }

    const result = await this.invitationService.getInvitationStats(cuid, currentuser.sub);

    res.status(httpStatusCodes.OK).json({
      success: result.success,
      message: result.message,
      data: result.data,
    });
  };

  getInvitationById = async (req: AppRequest, res: Response) => {
    const { currentuser } = req.context;
    const { iuid } = req.params;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('auth.errors.unauthorized'),
      });
    }

    // Get the invitation by iuid
    const invitation = await this.invitationService.getInvitationByIuid(iuid);
    if (!invitation) {
      return res.status(httpStatusCodes.NOT_FOUND).json({
        success: false,
        message: t('invitation.errors.notFound'),
      });
    }

    res.status(httpStatusCodes.OK).json({
      success: true,
      message: t('invitation.success.retrieved'),
      data: invitation,
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

    if (currentuser.email !== email) {
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

  validateInvitationCsv = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const { currentuser } = req.context;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('auth.errors.unauthorized'),
      });
    }

    if (!req.body.scannedFiles) {
      return res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: t('invitation.errors.noCsvFileUploaded'),
      });
    }

    const csvFile: ExtractedMediaFile = req.body.scannedFiles[0];
    const result = await this.invitationService.validateInvitationCsv(cuid, csvFile, currentuser);
    res.status(httpStatusCodes.OK).json(result);
  };

  importInvitationsFromCsv = async (req: AppRequest, res: Response) => {
    if (!req.body.scannedFiles) {
      return res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: t('invitation.errors.noCsvFileUploaded'),
      });
    }

    const csvFile: ExtractedMediaFile = req.body.scannedFiles[0];
    const result = await this.invitationService.importInvitationsFromCsv(req.context, csvFile.path);
    res.status(httpStatusCodes.OK).json(result);
  };

  processPendingInvitations = async (req: AppRequest, res: Response) => {
    const { currentuser } = req.context;
    const { cuid } = req.params;
    const { timeline, role, limit, dry_run } = req.query;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('auth.errors.unauthorized'),
      });
    }

    const result = await this.invitationService.processPendingInvitations(cuid, currentuser.sub, {
      timeline: timeline as string,
      role: role as string,
      limit: limit ? parseInt(limit as string) : undefined,
      dryRun: dry_run === 'true' || dry_run === '1',
    });

    res.status(httpStatusCodes.OK).json({
      success: result.success,
      message: result.message,
      data: result.data,
    });
  };
}
