import Logger from 'bunyan';
import { t } from '@shared/languages';
import { envVariables } from '@shared/config';
import { createLogger, JOB_NAME } from '@utils/index';
import { MailType } from '@interfaces/utils.interface';
import { ICurrentUser } from '@interfaces/user.interface';
import { InvitationQueue, EmailQueue } from '@queues/index';
import { EventEmitterService } from '@services/eventEmitter';
import { InvitationDAO, ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { EmailFailedPayload, EmailSentPayload, EventTypes } from '@interfaces/events.interface';
import {
  ISuccessReturnData,
  ExtractedMediaFile,
  IRequestContext,
} from '@interfaces/utils.interface';
import {
  UnauthorizedError,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from '@shared/customErrors';
import {
  IInvitationAcceptance,
  ISendInvitationResult,
  IResendInvitationData,
  IInvitationListQuery,
  IInvitationDocument,
  IInvitationStats,
  IInvitationData,
} from '@interfaces/invitation.interface';

interface IConstructor {
  emitterService: EventEmitterService;
  invitationQueue: InvitationQueue;
  invitationDAO: InvitationDAO;
  emailQueue: EmailQueue;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

export class InvitationService {
  private readonly log: Logger;
  private readonly invitationDAO: InvitationDAO;
  private readonly emailQueue: EmailQueue;
  private readonly userDAO: UserDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly clientDAO: ClientDAO;
  private readonly invitationQueue: InvitationQueue;
  private readonly emitterService: EventEmitterService;

  constructor({
    invitationDAO,
    emailQueue,
    userDAO,
    profileDAO,
    clientDAO,
    invitationQueue,
    emitterService,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.clientDAO = clientDAO;
    this.emailQueue = emailQueue;
    this.profileDAO = profileDAO;
    this.invitationDAO = invitationDAO;
    this.emitterService = emitterService;
    this.invitationQueue = invitationQueue;
    this.log = createLogger('InvitationService');
    this.setupEventListeners();
  }

  async sendInvitation(
    inviterUserId: string,
    cuid: string,
    invitationData: IInvitationData
  ): Promise<ISuccessReturnData<ISendInvitationResult>> {
    try {
      await this.validateInviterPermissions(inviterUserId, cuid);

      const client = await this.clientDAO.getClientBycuid(cuid);
      if (!client) {
        throw new NotFoundError({ message: t('client.errors.notFound') });
      }

      const existingInvitation = await this.invitationDAO.findPendingInvitation(
        invitationData.inviteeEmail,
        client.id
      );

      if (existingInvitation) {
        throw new ConflictError({
          message: t('invitation.errors.pendingInvitationExists'),
        });
      }

      const existingUser = await this.userDAO.getUserWithClientAccess(
        invitationData.inviteeEmail,
        client.cuid
      );

      if (existingUser) {
        throw new ConflictError({
          message: t('invitation.errors.userAlreadyHasAccess'),
        });
      }

      const invitation = await this.invitationDAO.createInvitation(
        invitationData,
        inviterUserId,
        client.id
      );

      const isDraft = invitationData.status === 'draft';
      let emailData: any = null;

      if (!isDraft) {
        const inviter = await this.userDAO.getUserById(inviterUserId, {
          populate: 'profile',
        });

        emailData = {
          to: invitationData.inviteeEmail,
          subject: t('email.invitation.subject', {
            companyName: client.displayName || client.companyProfile?.legalEntityName || 'Company',
          }),
          emailType: MailType.INVITATION,
          data: {
            inviteeName: `${invitationData.personalInfo.firstName} ${invitationData.personalInfo.lastName}`,
            inviterName: inviter?.profile?.fullname || inviter?.email || 'Team Member',
            companyName: client.displayName || client.companyProfile?.legalEntityName || 'Company',
            role: invitationData.role,
            invitationUrl: `${envVariables.FRONTEND.URL}/${cuid}/invitation?token=${invitation.invitationToken}`,
            expiresAt: invitation.expiresAt,
            customMessage: invitationData.metadata?.inviteMessage,
          },
        };

        this.emailQueue.addToEmailQueue(JOB_NAME.INVITATION_JOB, {
          ...emailData,
          invitationId: invitation._id.toString(),
        } as any);

        this.log.info(`Invitation sent to ${invitationData.inviteeEmail} for client ${cuid}`);
      } else {
        this.log.info(
          `Draft invitation created for ${invitationData.inviteeEmail} for client ${cuid}`
        );
      }

      return {
        success: true,
        data: { invitation, emailData },
        message: isDraft
          ? t('invitation.success.draftCreated', { email: invitationData.inviteeEmail })
          : t('invitation.success.sent', { email: invitationData.inviteeEmail }),
      };
    } catch (error) {
      this.log.error('Error processing invitation:', error);
      throw error;
    }
  }

  async acceptInvitation(
    cxt: IRequestContext,
    invitationData: IInvitationAcceptance
  ): Promise<ISuccessReturnData<{ user: any; invitation: IInvitationDocument }>> {
    // const { token } = cxt.request.params;
    const session = await this.invitationDAO.startSession();

    try {
      const result = await this.invitationDAO.withTransaction(session, async (session) => {
        const invitation = await this.invitationDAO.findByToken(invitationData.invitationToken);
        if (!invitation || !invitation.isValid()) {
          throw new BadRequestError({ message: t('invitation.errors.invalidOrExpired') });
        }

        const existingUser = await this.userDAO.getActiveUserByEmail(invitation.inviteeEmail);

        let user;
        if (existingUser) {
          user = await this.userDAO.addUserToClient(
            existingUser._id.toString(),
            invitation.clientId.toString(),
            invitation.role,
            invitation.inviteeFullName,
            session
          );
        } else {
          user = await this.userDAO.createUserFromInvitation(
            invitation,
            invitationData.userData,
            session
          );

          await this.profileDAO.createUserProfile(
            user._id,
            {
              user: user._id,
              puid: user.uid,
              personalInfo: {
                firstName: invitation.personalInfo.firstName,
                lastName: invitation.personalInfo.lastName,
                displayName: invitation.inviteeFullName,
                phoneNumber: invitation.personalInfo.phoneNumber || '',
                location: invitationData.userData.location || 'Unknown',
              },
              lang: invitationData.userData.lang || 'en',
              timeZone: invitationData.userData.timeZone || 'UTC',
            },
            session
          );
        }

        if (!user) {
          throw new BadRequestError({ message: 'Failed to create or find user' });
        }

        await this.invitationDAO.acceptInvitation(
          invitationData.invitationToken,
          user._id.toString(),
          session
        );

        return { user, invitation };
      });

      this.log.info(`Invitation accepted for ${result.invitation.inviteeEmail}`);

      return {
        success: true,
        data: result,
        message: t('invitation.success.accepted'),
      };
    } catch (error) {
      this.log.error('Error accepting invitation:', error);
      throw error;
    }
  }

  async getInvitationByIuid(iuid: string): Promise<ISuccessReturnData<IInvitationDocument | null>> {
    try {
      const invitation = await this.invitationDAO.findByIuidUnsecured(iuid);
      return {
        success: true,
        data: invitation,
        message: invitation ? t('invitation.success.retrieved') : t('invitation.info.notFound'),
      };
    } catch (error) {
      this.log.error('Error getting invitation by iuid:', error);
      throw error;
    }
  }

  async validateInvitationByToken(token: string): Promise<
    ISuccessReturnData<{
      invitation: IInvitationDocument;
      isValid: boolean;
      client: any;
    }>
  > {
    try {
      const invitation = await this.invitationDAO.findByToken(token);

      if (!invitation) {
        throw new NotFoundError({ message: t('invitation.errors.notFound') });
      }

      const isValid = invitation.isValid();

      if (!isValid) {
        throw new BadRequestError({ message: t('invitation.errors.invalidOrExpired') });
      }

      // Get client information
      const client = await this.clientDAO.getClientBycuid(invitation.clientId.toString());

      if (!client) {
        throw new NotFoundError({ message: t('client.errors.notFound') });
      }

      this.log.info(`Invitation token validated for ${invitation.inviteeEmail}`);

      return {
        success: true,
        data: {
          invitation,
          isValid,
          client: {
            cuid: client.cuid,
            displayName: client.displayName,
            companyName: client.companyProfile?.legalEntityName,
          },
        },
        message: t('invitation.success.tokenValid'),
      };
    } catch (error) {
      this.log.error('Error validating invitation token:', error);
      throw error;
    }
  }

  async revokeInvitation(
    iuid: string,
    revokerUserId: string,
    reason?: string
  ): Promise<ISuccessReturnData<IInvitationDocument>> {
    try {
      const invitation = await this.invitationDAO.findByIuidUnsecured(iuid);
      if (!invitation) {
        throw new NotFoundError({ message: t('invitation.errors.notFound') });
      }

      // Validate revoker has permission
      await this.validateInviterPermissions(revokerUserId, invitation.clientId.toString());

      if (!['pending', 'draft', 'sent'].includes(invitation.status)) {
        throw new BadRequestError({ message: t('invitation.errors.cannotRevoke') });
      }

      const revokedInvitation = await this.invitationDAO.revokeInvitation(
        iuid,
        invitation.clientId.toString(),
        revokerUserId,
        reason
      );

      this.log.info(`Invitation ${iuid} revoked by ${revokerUserId}`);

      return {
        success: true,
        data: revokedInvitation!,
        message: t('invitation.success.revoked'),
      };
    } catch (error) {
      this.log.error('Error revoking invitation:', error);
      throw error;
    }
  }

  async resendInvitation(
    data: IResendInvitationData,
    resenderUserId: string
  ): Promise<ISuccessReturnData<ISendInvitationResult>> {
    try {
      const invitation = await this.invitationDAO.findByIuidUnsecured(data.iuid);
      if (!invitation) {
        throw new NotFoundError({ message: t('invitation.errors.notFound') });
      }

      await this.validateInviterPermissions(resenderUserId, invitation.clientId.toString());

      if (invitation.status !== 'pending') {
        throw new BadRequestError({ message: t('invitation.errors.cannotResend') });
      }

      if (!invitation.isValid()) {
        throw new BadRequestError({ message: t('invitation.errors.expired') });
      }

      // Get client and resender information
      const [client, resender] = await Promise.all([
        this.clientDAO.getClientBycuid(invitation.clientId.toString()),
        this.userDAO.getUserById(resenderUserId, { populate: 'profile' }),
      ]);

      // Prepare email data
      const emailData = {
        to: invitation.inviteeEmail,
        subject: t('email.invitation.reminderSubject', {
          companyName: client?.displayName || 'Company',
        }),
        emailType: MailType.INVITATION_REMINDER,
        data: {
          inviteeName: invitation.inviteeFullName,
          resenderName: resender?.profile?.fullname || resender?.email || 'Team Member',
          companyName: client?.displayName || 'Company',
          role: invitation.role,
          invitationUrl: `${envVariables.FRONTEND.URL}/${invitation.clientId}/invitation?token=${invitation.invitationToken}`,
          expiresAt: invitation.expiresAt,
          customMessage: data.customMessage || invitation.metadata?.inviteMessage,
        },
      };

      // Update reminder count
      await this.invitationDAO.incrementReminderCount(data.iuid, invitation.clientId.toString());

      // Queue email with invitation ID for status tracking
      this.emailQueue.addToEmailQueue(JOB_NAME.INVITATION_JOB, {
        ...emailData,
        invitationId: invitation._id.toString(),
      } as any);

      this.log.info(`Invitation reminder sent for ${invitation.inviteeEmail}`);

      return {
        success: true,
        data: { invitation, emailData },
        message: t('invitation.success.resent', { email: invitation.inviteeEmail }),
      };
    } catch (error) {
      this.log.error('Error resending invitation:', error);
      throw error;
    }
  }

  async getInvitations(
    query: IInvitationListQuery,
    requestorUserId: string
  ): Promise<ISuccessReturnData<any>> {
    try {
      await this.validateInviterPermissions(requestorUserId, query.clientId);

      const result = await this.invitationDAO.getInvitationsByClient(query);

      return {
        success: true,
        data: result,
        message: t('invitation.success.listed'),
      };
    } catch (error) {
      this.log.error('Error getting invitations:', error);
      throw error;
    }
  }

  async getInvitationStats(
    clientId: string,
    requestorUserId: string
  ): Promise<ISuccessReturnData<IInvitationStats>> {
    try {
      await this.validateInviterPermissions(requestorUserId, clientId);

      const stats = await this.invitationDAO.getInvitationStats(clientId);

      return {
        success: true,
        data: stats,
        message: t('invitation.success.statsRetrieved'),
      };
    } catch (error) {
      this.log.error('Error getting invitation stats:', error);
      throw error;
    }
  }

  async expireInvitations(): Promise<ISuccessReturnData<{ expiredCount: number }>> {
    try {
      const expiredCount = await this.invitationDAO.expireInvitations();
      this.log.info(`Expired ${expiredCount} invitations`);
      return {
        success: true,
        data: { expiredCount },
        message: t('invitation.success.expired', { count: expiredCount }),
      };
    } catch (error) {
      this.log.error('Error expiring invitations:', error);
      throw error;
    }
  }

  private async validateInviterPermissions(userId: string, cuid: string): Promise<void> {
    const user = await this.userDAO.getUserById(userId);
    if (!user) {
      throw new UnauthorizedError({ message: t('auth.errors.userNotFound') });
    }

    const clientConnection = user.cuids.find((c) => c.cuid === cuid && c.isConnected);
    if (!clientConnection) {
      throw new ForbiddenError({ message: t('auth.errors.noAccessToClient') });
    }

    // Check if user has admin or manager role for this client
    const hasPermission = clientConnection.roles.some((role) =>
      ['manager', 'admin'].includes(role)
    );

    if (!hasPermission) {
      throw new ForbiddenError({
        message: t('invitation.errors.insufficientPermissions'),
      });
    }
  }

  async validateInvitationCsv(
    cuid: string,
    csvFile: ExtractedMediaFile,
    currentUser: ICurrentUser
  ): Promise<ISuccessReturnData> {
    try {
      if (!csvFile) {
        throw new BadRequestError({ message: t('invitation.errors.noCsvFileUploaded') });
      }

      const client = await this.clientDAO.getClientBycuid(cuid);
      if (!client) {
        this.log.error(`Client with cuid ${cuid} not found`);
        throw new BadRequestError({ message: t('invitation.errors.clientNotFound') });
      }

      // Validate user has permission to invite users for this client
      await this.validateInviterPermissions(currentUser.sub, cuid);

      // check file size (10MB limit)
      if (csvFile.fileSize > 10 * 1024 * 1024) {
        throw new BadRequestError({ message: t('invitation.errors.fileTooLarge') });
      }

      const jobData = {
        userId: currentUser.sub,
        csvFilePath: csvFile.path,
        clientInfo: { cuid, displayName: client.displayName, id: client.id },
      };

      const job = await this.invitationQueue.addCsvValidationJob(jobData);

      return {
        success: true,
        data: { processId: job.id },
        message: t('invitation.success.csvValidationStarted'),
      };
    } catch (error) {
      this.log.error('Error validating invitation CSV:', error);
      throw error;
    }
  }

  async importInvitationsFromCsv(
    cxt: IRequestContext,
    csvFilePath: string
  ): Promise<ISuccessReturnData> {
    const { cuid } = cxt.request.params;
    const userId = cxt.currentuser!.sub;

    try {
      if (!csvFilePath || !cuid) {
        throw new BadRequestError({ message: t('invitation.errors.noCsvFileUploaded') });
      }

      const client = await this.clientDAO.getClientBycuid(cuid);
      if (!client) {
        this.log.error(`Client with cuid ${cuid} not found`);
        throw new BadRequestError({ message: t('invitation.errors.clientNotFound') });
      }

      await this.validateInviterPermissions(userId, cuid);

      const jobData = {
        userId,
        csvFilePath,
        clientInfo: { cuid, displayName: client.displayName, id: client.id },
      };

      const job = await this.invitationQueue.addCsvImportJob(jobData);

      return {
        success: true,
        data: { processId: job.id },
        message: t('invitation.success.csvImportStarted'),
      };
    } catch (error) {
      this.log.error('Error importing invitations from CSV:', error);
      throw error;
    }
  }

  async processPendingInvitations(
    clientId: string,
    processorUserId: string,
    filters: {
      timeline?: string;
      role?: string;
      limit?: number;
      dryRun?: boolean;
    }
  ): Promise<ISuccessReturnData<any>> {
    try {
      await this.validateInviterPermissions(processorUserId, clientId);

      const query: IInvitationListQuery = {
        clientId,
        status: 'pending',
        limit: filters.limit || 50,
      };

      if (filters.role) {
        query.role = filters.role as any;
      }

      let timelineFilter: Date | undefined;
      if (filters.timeline) {
        const now = new Date();
        switch (filters.timeline) {
          case '24h':
            timelineFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            break;
          case '48h':
            timelineFilter = new Date(now.getTime() - 48 * 60 * 60 * 1000);
            break;
          case '72h':
            timelineFilter = new Date(now.getTime() - 72 * 60 * 60 * 1000);
            break;
          case '7d':
            timelineFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
        }
      }

      const pendingInvitations = await this.invitationDAO.getInvitationsByClient(query);

      let invitationsToProcess = pendingInvitations.items;
      if (timelineFilter) {
        invitationsToProcess = invitationsToProcess.filter(
          (invitation) => new Date(invitation.createdAt) >= timelineFilter!
        );
      }

      // If dry run, return what would be processed
      if (filters.dryRun) {
        return {
          success: true,
          message: t('invitation.success.dryRunCompleted'),
          data: {
            totalFound: invitationsToProcess.length,
            invitations: invitationsToProcess.map((inv) => ({
              iuid: inv.iuid,
              inviteeEmail: inv.inviteeEmail,
              role: inv.role,
              createdAt: inv.createdAt,
              inviteeFullName: inv.inviteeFullName,
            })),
            filters: {
              timeline: filters.timeline,
              role: filters.role,
              limit: filters.limit,
            },
          },
        };
      }

      let processed = 0;
      let failed = 0;
      const errors: Array<{ iuid: string; email: string; error: string }> = [];

      this.log.info(
        `Processing ${invitationsToProcess.length} pending invitations for client ${clientId}`
      );

      for (const invitation of invitationsToProcess) {
        try {
          await this.resendInvitation(
            {
              iuid: invitation.iuid,
            },
            processorUserId
          );
          processed++;
        } catch (error: any) {
          failed++;
          errors.push({
            iuid: invitation.iuid,
            email: invitation.inviteeEmail,
            error: error.message || 'Unknown error',
          });
          this.log.error(
            `Failed to process invitation ${invitation.iuid} for ${invitation.inviteeEmail}:`,
            error
          );
        }
      }

      const message =
        processed > 0
          ? t('invitation.success.pendingProcessed', {
              processed,
              total: invitationsToProcess.length,
            })
          : t('invitation.info.noPendingFound');

      return {
        success: true,
        message,
        data: {
          processed,
          failed,
          skipped: 0,
          totalFound: invitationsToProcess.length,
          timeline: filters.timeline,
          role: filters.role,
          errors: errors.length > 0 ? errors : undefined,
        },
      };
    } catch (error) {
      this.log.error('Error processing pending invitations:', error);
      throw error;
    }
  }

  private setupEventListeners(): void {
    this.emitterService.on(EventTypes.EMAIL_SENT, this.handleEmailSent.bind(this));
    this.emitterService.on(EventTypes.EMAIL_FAILED, this.handleEmailFailed.bind(this));
  }

  private async handleEmailSent(payload: EmailSentPayload): Promise<void> {
    if (
      payload.emailType === MailType.INVITATION ||
      payload.emailType === MailType.INVITATION_REMINDER
    ) {
      const invitationId = payload.jobData?.invitationId;
      const clientId = payload.jobData?.data?.clientId;

      if (invitationId && clientId) {
        try {
          await this.invitationDAO.updateInvitationStatus(invitationId, clientId, 'sent');
          this.log.info(`Updated invitation ${invitationId} status to 'sent'`);
        } catch (error) {
          this.log.error(`Failed to update invitation ${invitationId} status:`, error);
        }
      }
    }
  }

  private async handleEmailFailed(payload: EmailFailedPayload): Promise<void> {
    if (
      payload.emailType === MailType.INVITATION ||
      payload.emailType === MailType.INVITATION_REMINDER
    ) {
      const invitationId = payload.jobData?.invitationId;

      if (invitationId) {
        try {
          //todo: add additional error tracking here
          this.log.error(`Email failed for invitation ${invitationId}: ${payload.error.message}`);
        } catch (error) {
          this.log.error(`Failed to handle email failure for invitation ${invitationId}:`, error);
        }
      }
    }
  }

  destroy(): void {
    this.emitterService.off(EventTypes.EMAIL_SENT, this.handleEmailSent);
    this.emitterService.off(EventTypes.EMAIL_FAILED, this.handleEmailFailed);
  }
}
