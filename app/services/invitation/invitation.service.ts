import Logger from 'bunyan';
import { t } from '@shared/languages';
import { envVariables } from '@shared/config';
import { VendorService } from '@services/index';
import { ProfileService } from '@services/profile';
import { createLogger, JOB_NAME } from '@utils/index';
import { MailType } from '@interfaces/utils.interface';
import { ICurrentUser } from '@interfaces/user.interface';
import { InvitationQueue, EmailQueue } from '@queues/index';
import { EventEmitterService } from '@services/eventEmitter';
import { InvitationDAO, ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { InvitationValidations } from '@shared/validations/InvitationValidation';
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
  profileService: ProfileService;
  vendorService: VendorService;
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
  private readonly profileService: ProfileService;
  private readonly vendorService: VendorService;

  constructor({
    invitationDAO,
    emailQueue,
    userDAO,
    profileDAO,
    clientDAO,
    invitationQueue,
    emitterService,
    profileService,
    vendorService,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.clientDAO = clientDAO;
    this.emailQueue = emailQueue;
    this.profileDAO = profileDAO;
    this.invitationDAO = invitationDAO;
    this.emitterService = emitterService;
    this.invitationQueue = invitationQueue;
    this.profileService = profileService;
    this.vendorService = vendorService;
    this.log = createLogger('InvitationService');
    this.setupEventListeners();
  }

  async sendInvitation(
    inviterUserId: string,
    cuid: string,
    invitationData: IInvitationData
  ): Promise<ISuccessReturnData<ISendInvitationResult>> {
    try {
      const validatedData = InvitationValidations.sendInvitation.parse(invitationData);
      await this.validateInviterPermissions(inviterUserId, cuid);

      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        throw new NotFoundError({ message: t('client.errors.notFound') });
      }

      const inviterUser = await this.userDAO.getUserById(inviterUserId);
      if (!inviterUser) {
        throw new UnauthorizedError({ message: t('auth.errors.userNotFound') });
      }

      if (inviterUser.email.toLowerCase() === validatedData.inviteeEmail.toLowerCase()) {
        throw new BadRequestError({
          message: t('invitation.errors.cannotInviteYourself'),
        });
      }

      const existingInvitation = await this.invitationDAO.findPendingInvitation(
        validatedData.inviteeEmail,
        client.id
      );

      if (existingInvitation) {
        throw new ConflictError({
          message: t('invitation.errors.pendingInvitationExists'),
        });
      }

      const existingUser = await this.userDAO.getUserWithClientAccess(
        validatedData.inviteeEmail,
        client.cuid
      );

      if (existingUser) {
        throw new ConflictError({
          message: t('invitation.errors.userAlreadyHasAccess'),
        });
      }

      const invitation = await this.invitationDAO.createInvitation(
        validatedData as IInvitationData,
        inviterUserId,
        client.id
      );

      const isDraft = validatedData.status === 'draft';
      let emailData: any = null;

      if (!isDraft) {
        const inviter = await this.userDAO.getUserById(inviterUserId, {
          populate: 'profile',
        });

        emailData = {
          to: validatedData.inviteeEmail,
          subject: t('email.invitation.subject', {
            companyName: client.displayName || client.companyProfile?.legalEntityName || 'Company',
          }),
          client: {
            cuid: client.cuid,
            id: client.id,
          },
          emailType: MailType.INVITATION,
          data: {
            role: validatedData.role,
            expiresAt: invitation.expiresAt,
            customMessage: validatedData.metadata?.inviteMessage,
            inviterName: inviter?.profile?.fullname || inviter?.email || 'Team Member',
            companyName: client.displayName || client.companyProfile?.legalEntityName || 'Company',
            inviteeName: `${validatedData.personalInfo.firstName} ${validatedData.personalInfo.lastName}`,
            invitationUrl: `${envVariables.FRONTEND.URL}/invite/${cuid}/?token=${invitation.invitationToken}`,
          },
        };

        this.emailQueue.addToEmailQueue(JOB_NAME.INVITATION_JOB, {
          ...emailData,
          invitationId: invitation._id.toString(),
        } as any);

        this.log.info(`Invitation sent to ${validatedData.inviteeEmail} for client ${cuid}`);
      } else {
        this.log.info(
          `Draft invitation created for ${validatedData.inviteeEmail} for client ${cuid}`
        );
      }

      return {
        success: true,
        data: { invitation, emailData },
        message: isDraft
          ? t('invitation.success.draftCreated', { email: validatedData.inviteeEmail })
          : t('invitation.success.sent', { email: validatedData.inviteeEmail }),
      };
    } catch (error) {
      this.log.error('Error sending invitation:', error);
      throw error;
    }
  }

  async updateInvitation(
    context: IRequestContext,
    invitationData: IInvitationData,
    currentuser: ICurrentUser
  ): Promise<ISuccessReturnData<ISendInvitationResult>> {
    const { cuid, iuid } = context.request.params;
    const updaterUserId = currentuser.sub;
    if (!cuid || !iuid) {
      throw new BadRequestError({ message: t('invitation.errors.missingParams') });
    }

    try {
      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        throw new NotFoundError({ message: t('client.errors.notFound') });
      }

      const existingInvitation = await this.invitationDAO.findByIuid(iuid, client.id);
      if (!existingInvitation) {
        throw new NotFoundError({ message: t('invitation.errors.notFound') });
      }

      if (existingInvitation.status !== 'draft') {
        throw new BadRequestError({
          message: t('invitation.errors.canOnlyEditDraft'),
        });
      }

      const updaterUser = await this.userDAO.getUserById(updaterUserId);
      if (!updaterUser) {
        throw new UnauthorizedError({ message: t('auth.errors.userNotFound') });
      }

      if (updaterUser.email.toLowerCase() === invitationData.inviteeEmail.toLowerCase()) {
        throw new BadRequestError({
          message: t('invitation.errors.cannotInviteYourself'),
        });
      }

      if (existingInvitation.inviteeEmail !== invitationData.inviteeEmail.toLowerCase()) {
        const conflictingInvitation = await this.invitationDAO.findPendingInvitation(
          invitationData.inviteeEmail,
          client.id
        );

        if (conflictingInvitation && conflictingInvitation.iuid !== iuid) {
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
      }

      const updatedInvitation = await this.invitationDAO.updateInvitation(
        iuid,
        client.id,
        invitationData
      );

      if (!updatedInvitation) {
        throw new BadRequestError({ message: t('invitation.errors.updateFailed') });
      }

      this.log.info(`Invitation ${iuid} updated for client ${cuid}`);

      return {
        success: true,
        data: { invitation: updatedInvitation, emailData: null },
        message: t('invitation.success.updated', { email: invitationData.inviteeEmail }),
      };
    } catch (error) {
      this.log.error('Error updating invitation:', error);
      throw error;
    }
  }

  async acceptInvitation(
    cuid: string,
    invitationData: IInvitationAcceptance
  ): Promise<ISuccessReturnData<{ user: any; invitation: IInvitationDocument }>> {
    const session = await this.invitationDAO.startSession();
    const result = await this.invitationDAO.withTransaction(session, async (session) => {
      const invitation = await this.invitationDAO.findByToken(invitationData.token);
      if (!invitation || !invitation.isValid()) {
        throw new BadRequestError({ message: t('invitation.errors.invalidOrExpired') });
      }

      const existingUser = await this.userDAO.getActiveUserByEmail(invitation.inviteeEmail);
      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        throw new NotFoundError({ message: t('client.errors.notFound') });
      }

      let user;
      const linkedVendorId =
        invitation.linkedVendorId && invitation.role === 'vendor'
          ? invitation.linkedVendorId.toString()
          : undefined;
      if (existingUser) {
        user = await this.userDAO.addUserToClient(
          existingUser._id.toString(),
          invitation.role,
          {
            id: client.id.toString(),
            cuid,
            clientDisplayName: client.displayName || client.companyProfile?.legalEntityName,
          },
          linkedVendorId,
          session
        );
      } else {
        user = await this.userDAO.createUserFromInvitation(
          { cuid, displayName: client.displayName || client.companyProfile?.legalEntityName },
          invitation,
          invitationData,
          linkedVendorId,
          session
        );

        if (!user) {
          throw new BadRequestError({ message: 'Error creating user account.' });
        }

        const profileData = {
          user: user._id,
          puid: user.uid,
          personalInfo: {
            firstName: invitation.personalInfo.firstName,
            lastName: invitation.personalInfo.lastName,
            displayName: invitation.inviteeFullName,
            phoneNumber: invitation.personalInfo.phoneNumber || '',
            location: invitationData.location || 'Unknown',
          },
          lang: invitationData.lang || 'en',
          timeZone: invitationData.timeZone || 'UTC',
          policies: {
            tos: {
              accepted: invitationData.termsAccepted || false,
              acceptedOn: invitationData.termsAccepted ? new Date() : null,
            },
            marketing: {
              accepted: invitationData.newsletterOptIn || false,
              acceptedOn: invitationData.newsletterOptIn ? new Date() : null,
            },
          },
        };

        await this.profileDAO.createUserProfile(user._id, profileData, session);
      }

      if (!user) {
        throw new BadRequestError({ message: 'Error creating user account.' });
      }

      await this.invitationDAO.acceptInvitation(invitationData.token, user._id.toString(), session);

      return { user, invitation };
    });

    // Pass invitation metadata to profile initialization
    const metadata = {
      employeeInfo: result.invitation.metadata?.employeeInfo,
      vendorInfo: result.invitation.metadata?.vendorInfo,
    };

    await this.profileService.initializeRoleInfo(
      result.user._id.toString(),
      cuid,
      result.invitation.role,
      result.invitation.linkedVendorId?.toString(),
      metadata
    );

    if (result.invitation.linkedVendorId && result.invitation.role === 'vendor') {
      this.log.info(
        `Vendor link established from primary vendor ${result.invitation.linkedVendorId} to new user ${result.user._id}`
      );
    }

    return {
      success: true,
      data: result,
      message: t('invitation.success.accepted'),
    };
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

  async validateInvitationByToken(
    cuid: string,
    token: string
  ): Promise<
    ISuccessReturnData<{
      invitation: IInvitationDocument;
      isValid: boolean;
      client: any;
    }>
  > {
    const [invitation, client] = await Promise.all([
      this.invitationDAO.findByToken(token),
      this.clientDAO.findFirst({ cuid }),
    ]);
    if (!invitation) {
      throw new NotFoundError({ message: t('invitation.errors.notFound') });
    }

    if (!client) {
      throw new NotFoundError({ message: t('client.errors.notFound') });
    }

    if (invitation.clientId.toString() !== client.id.toString()) {
      throw new ForbiddenError({ message: t('invitation.errors.invalidClient') });
    }

    const isValid = invitation.isValid();

    if (!isValid) {
      throw new BadRequestError({ message: t('invitation.errors.invalidOrExpired') });
    }

    const invite = invitation.toJSON();
    delete invite.invitedBy.profile;
    return {
      success: true,
      data: {
        invitation: invite as IInvitationDocument,
        isValid,
        client: {
          cuid: client.cuid,
          displayName: client.displayName,
          companyName: client.companyProfile?.legalEntityName || client.companyProfile?.tradingName,
        },
      },
      message: t('invitation.success.tokenValid'),
    };
  }

  async revokeInvitation(
    iuid: string,
    revokerUserId: string,
    reason?: string
  ): Promise<ISuccessReturnData<IInvitationDocument>> {
    const invitation = await this.invitationDAO.findByIuidUnsecured(iuid);
    if (!invitation) {
      throw new NotFoundError({ message: t('invitation.errors.notFound') });
    }

    if (!['pending', 'draft', 'sent'].includes(invitation.status)) {
      throw new BadRequestError({ message: t('invitation.errors.cannotRevoke') });
    }

    const revokedInvitation = await this.invitationDAO.revokeInvitation(
      iuid,
      invitation.clientId.toString(),
      revokerUserId,
      reason
    );

    return {
      success: true,
      data: revokedInvitation!,
      message: t('invitation.success.revoked'),
    };
  }

  async declineInvitation(
    cuid: string,
    data: {
      token: string;
      reason?: string;
    }
  ): Promise<ISuccessReturnData<IInvitationDocument>> {
    const invitation = await this.invitationDAO.findByToken(data.token);
    if (!invitation) {
      throw new NotFoundError({ message: t('invitation.errors.notFound') });
    }

    if (!['pending', 'sent'].includes(invitation.status)) {
      throw new BadRequestError({ message: t('invitation.errors.cannotDecline') });
    }

    const declinedInvitation = await this.invitationDAO.declineInvitation(
      invitation.iuid,
      invitation.clientId.toString(),
      data.reason
    );
    if (!declinedInvitation) {
      throw new BadRequestError({ message: t('invitation.errors.declineFailed') });
    }
    return {
      success: true,
      data: declinedInvitation,
      message: t('invitation.success.declined'),
    };
  }

  async resendInvitation(
    data: IResendInvitationData,
    resenderUserId: string
  ): Promise<ISuccessReturnData<ISendInvitationResult>> {
    try {
      const validatedData = InvitationValidations.resendInvitation.parse(
        data
      ) as IResendInvitationData;

      let invitation = await this.invitationDAO.findByIuidUnsecured(data.iuid);
      if (!invitation) {
        throw new NotFoundError({ message: t('invitation.errors.notFound') });
      }

      if (!['draft'].includes(invitation.status)) {
        throw new BadRequestError({ message: t('invitation.errors.cannotResend') });
      }

      if (!invitation.isValid()) {
        throw new BadRequestError({ message: t('invitation.errors.expired') });
      }

      const [client, resender] = await Promise.all([
        this.clientDAO.findById(invitation.clientId.toString()),
        this.userDAO.getUserById(resenderUserId, { populate: 'profile' }),
      ]);

      if (!client) {
        throw new NotFoundError({ message: t('client.errors.notFound') });
      }

      if (resender && resender.email.toLowerCase() === invitation.inviteeEmail.toLowerCase()) {
        throw new BadRequestError({
          message: t('invitation.errors.cannotInviteYourself'),
        });
      }

      const isDraftInvitation = invitation.status === 'draft';
      const isReactivation = invitation.status === 'revoked';

      const emailData = {
        client: {
          cuid: client.cuid,
          id: client.id,
        },
        to: invitation.inviteeEmail,
        subject: isDraftInvitation
          ? t('email.invitation.subject', {
              companyName:
                client?.displayName || client?.companyProfile?.legalEntityName || 'Company',
            })
          : t('email.invitation.reminderSubject', {
              companyName:
                client?.displayName || client?.companyProfile?.legalEntityName || 'Company',
            }),
        emailType: isDraftInvitation ? MailType.INVITATION : MailType.INVITATION_REMINDER,
        data: {
          role: invitation.role,
          expiresAt: invitation.expiresAt,
          inviteeName: invitation.inviteeFullName,
          resenderName: resender?.profile?.fullname || 'Team Member',
          inviterName: resender?.profile?.fullname || resender?.email || 'Team Member',
          customMessage: validatedData.customMessage || invitation.metadata?.inviteMessage,
          companyName: client?.displayName || client?.companyProfile?.legalEntityName || 'Company',
          invitationUrl: `${envVariables.FRONTEND.URL}/invite/${client?.cuid}/?token=${invitation.invitationToken}`,
        },
      };

      if (isReactivation || isDraftInvitation) {
        invitation = await this.invitationDAO.updateInvitationStatus(
          invitation._id.toString(),
          invitation.clientId.toString(),
          'pending'
        );
        if (!invitation) {
          throw new BadRequestError({ message: t('invitation.errors.reactivationFailed') });
        }
      } else {
        await this.invitationDAO.incrementReminderCount(data.iuid, invitation.clientId.toString());
      }

      this.emailQueue.addToEmailQueue(JOB_NAME.INVITATION_JOB, {
        ...emailData,
        invitationId: invitation._id.toString(),
      } as any);

      this.log.info(
        `Invitation ${isReactivation ? 'reactivated and sent' : isDraftInvitation ? 'activated and sent' : 'reminder sent'} for ${invitation.inviteeEmail}`
      );

      return {
        success: true,
        data: { invitation, emailData },
        message: isReactivation
          ? t('invitation.success.reactivated', { email: invitation.inviteeEmail })
          : isDraftInvitation
            ? t('invitation.success.sent', { email: invitation.inviteeEmail })
            : t('invitation.success.resent', { email: invitation.inviteeEmail }),
      };
    } catch (error) {
      this.log.error('Error resending invitation:', error);
      throw error;
    }
  }

  async getInvitations(
    cxt: IRequestContext,
    query: IInvitationListQuery
  ): Promise<ISuccessReturnData<any>> {
    const result = await this.invitationDAO.getInvitationsByClient(query);

    return {
      success: true,
      data: result,
      message: t('invitation.success.listed'),
    };
  }

  async getInvitationStats(
    clientId: string,
    _requestorUserId: string
  ): Promise<ISuccessReturnData<IInvitationStats>> {
    try {
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

      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        this.log.error(`Client with cuid ${cuid} not found`);
        throw new BadRequestError({ message: t('invitation.errors.clientNotFound') });
      }

      if (csvFile.fileSize > 10 * 1024 * 1024) {
        throw new BadRequestError({ message: t('invitation.errors.fileTooLarge') });
      }

      const jobData = {
        userId: currentUser.sub,
        csvFilePath: csvFile.path,
        clientInfo: { cuid, clientDisplayName: client.displayName, id: client.id },
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

  async validateBulkUserCsv(
    cuid: string,
    csvFile: ExtractedMediaFile,
    currentUser: ICurrentUser,
    options: { sendNotifications?: boolean; passwordLength?: number }
  ): Promise<ISuccessReturnData> {
    try {
      if (!csvFile) {
        throw new BadRequestError({ message: t('invitation.errors.noCsvFileUploaded') });
      }

      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        this.log.error(`Client with cuid ${cuid} not found`);
        throw new BadRequestError({ message: t('invitation.errors.clientNotFound') });
      }

      if (csvFile.fileSize > 10 * 1024 * 1024) {
        throw new BadRequestError({ message: t('invitation.errors.fileTooLarge') });
      }

      const jobData = {
        userId: currentUser.sub,
        csvFilePath: csvFile.path,
        clientInfo: { cuid, clientDisplayName: client.displayName, id: client.id },
        bulkCreateOptions: {
          sendNotifications: options.sendNotifications || false,
          passwordLength: options.passwordLength || 12,
        },
      };

      const job = await this.invitationQueue.addCsvBulkUserValidationJob(jobData);

      return {
        success: true,
        data: { processId: job.id },
        message: t('invitation.success.csvValidationStarted'),
      };
    } catch (error) {
      this.log.error('Error validating bulk user CSV:', error);
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

      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        this.log.error(`Client with cuid ${cuid} not found`);
        throw new BadRequestError({ message: t('invitation.errors.clientNotFound') });
      }

      const jobData = {
        userId,
        csvFilePath,
        clientInfo: { cuid, clientDisplayName: client.displayName, id: client.id },
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

  async importBulkUsersFromCsv(
    cxt: IRequestContext,
    csvFilePath: string,
    options: { sendNotifications?: boolean; passwordLength?: number }
  ): Promise<ISuccessReturnData> {
    const { cuid } = cxt.request.params;
    const userId = cxt.currentuser!.sub;

    try {
      if (!csvFilePath || !cuid) {
        throw new BadRequestError({ message: t('invitation.errors.noCsvFileUploaded') });
      }

      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        this.log.error(`Client with cuid ${cuid} not found`);
        throw new BadRequestError({ message: t('invitation.errors.clientNotFound') });
      }

      const jobData = {
        userId,
        csvFilePath,
        clientInfo: { cuid, clientDisplayName: client.displayName, id: client.id },
        bulkCreateOptions: {
          sendNotifications: options.sendNotifications || false,
          passwordLength: options.passwordLength || 12,
        },
      };

      const job = await this.invitationQueue.addCsvBulkUserImportJob(jobData);

      return {
        success: true,
        data: { processId: job.id },
        message: t('invitation.success.csvImportStarted'),
      };
    } catch (error) {
      this.log.error('Error importing bulk users from CSV:', error);
      throw error;
    }
  }

  async processPendingInvitations(
    cuid: string,
    processorUserId: string,
    filters: {
      timeline?: string;
      role?: string;
      limit?: number;
      dryRun?: boolean;
    }
  ): Promise<ISuccessReturnData<any>> {
    try {
      const query: IInvitationListQuery = {
        cuid,
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
        `Processing ${invitationsToProcess.length} pending invitations for client ${cuid}`
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
      const clientId = payload.jobData?.client?.id;

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
