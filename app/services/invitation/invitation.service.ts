import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { envVariables } from '@shared/config';
import { QueueFactory } from '@services/queue';
import { ProfileService } from '@services/profile';
import { createLogger, JOB_NAME } from '@utils/index';
import { MailType } from '@interfaces/utils.interface';
import { ICurrentUser } from '@interfaces/user.interface';
import { InvitationQueue, EmailQueue } from '@queues/index';
import { EventEmitterService } from '@services/eventEmitter';
import { ROLE_GROUPS, ROLES } from '@shared/constants/roles.constants';
import { IPaymentGatewayProvider } from '@interfaces/subscription.interface';
import { InvitationValidations } from '@shared/validations/InvitationValidation';
import { PaymentGatewayService, VendorService, UserService } from '@services/index';
import { EmailFailedPayload, EmailSentPayload, EventTypes } from '@interfaces/events.interface';
import { PaymentProcessorDAO, InvitationDAO, ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
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
  paymentGatewayService: PaymentGatewayService;
  paymentProcessorDAO: PaymentProcessorDAO;
  emitterService: EventEmitterService;
  profileService: ProfileService;
  invitationDAO: InvitationDAO;
  vendorService: VendorService;
  queueFactory: QueueFactory;
  userService: UserService;
  subscriptionService: any;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
  leaseDAO: any;
}

export class InvitationService {
  private readonly log: Logger;
  private readonly invitationDAO: InvitationDAO;
  private readonly queueFactory: QueueFactory;
  private readonly userDAO: UserDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly clientDAO: ClientDAO;
  private readonly emitterService: EventEmitterService;
  private readonly profileService: ProfileService;
  private readonly vendorService: VendorService;
  private readonly userService: UserService;
  private readonly paymentProcessorDAO: PaymentProcessorDAO;
  private readonly paymentGatewayService: PaymentGatewayService;
  private readonly leaseDAO: any;
  private readonly subscriptionService: any;

  constructor({
    invitationDAO,
    queueFactory,
    userDAO,
    profileDAO,
    clientDAO,
    emitterService,
    profileService,
    vendorService,
    userService,
    leaseDAO,
    subscriptionService,
    paymentProcessorDAO,
    paymentGatewayService,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.clientDAO = clientDAO;
    this.queueFactory = queueFactory;
    this.profileDAO = profileDAO;
    this.subscriptionService = subscriptionService;
    this.invitationDAO = invitationDAO;
    this.emitterService = emitterService;
    this.profileService = profileService;
    this.vendorService = vendorService;
    this.userService = userService;
    this.paymentProcessorDAO = paymentProcessorDAO;
    this.paymentGatewayService = paymentGatewayService;
    this.leaseDAO = leaseDAO;
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

      // Check seat availability for employee roles
      const EMPLOYEE_ROLES = ['super-admin', 'admin', 'manager', 'staff'];
      if (EMPLOYEE_ROLES.includes(validatedData.role)) {
        try {
          const seatInfo = await this.subscriptionService.getAvailableSeats(cuid);

          if (seatInfo.availableSeats <= 0) {
            const canPurchase = seatInfo.canPurchaseMore;
            const message = canPurchase
              ? `Seat limit reached. Your plan allows ${seatInfo.totalAllowed} seats (${seatInfo.includedSeats} included + ${seatInfo.additionalSeats} additional). You can purchase up to ${seatInfo.maxAdditionalSeats - seatInfo.additionalSeats} more seats.`
              : `Seat limit reached. Your plan allows ${seatInfo.totalAllowed} seats. Please upgrade your plan or archive users to free up seats.`;

            throw new BadRequestError({ message });
          }
        } catch (error) {
          if (error instanceof BadRequestError) {
            throw error;
          }
          this.log.error({ error, cuid }, 'Error checking seat availability');
          // Don't block invitation if seat check fails - let event handler handle it
        }
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
            customMessage: validatedData.metadata?.inviteMessage || '',
            inviterName: inviter?.profile?.fullname || inviter?.email || 'Team Member',
            companyName: client.displayName || client.companyProfile?.legalEntityName || 'Company',
            inviteeName: `${validatedData.personalInfo.firstName} ${validatedData.personalInfo.lastName}`,
            invitationUrl: `${envVariables.FRONTEND.URL}/invite/${cuid}/?token=${invitation.invitationToken}`,
          },
        };

        const emailQueue = this.queueFactory.getQueue('emailQueue') as EmailQueue;
        emailQueue.addToEmailQueue(JOB_NAME.INVITATION_JOB, {
          ...emailData,
          invitationId: invitation._id.toString(),
        } as any);

        this.emitterService.emit(EventTypes.INVITATION_SENT, {
          invitationId: invitation._id.toString(),
          inviteeEmail: validatedData.inviteeEmail,
          clientId: client.id,
          role: validatedData.role,
          cuid,
        });
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

  /**
   * Validate invitation token and retrieve client data
   */
  private async validateInvitationAndClient(
    cuid: string,
    token: string
  ): Promise<{ invitation: IInvitationDocument; client: any; linkedVendorUid?: string }> {
    const invitation = await this.invitationDAO.findByToken(token);
    if (!invitation || !invitation.isValid()) {
      throw new BadRequestError({ message: t('invitation.errors.invalidOrExpired') });
    }

    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client) {
      throw new NotFoundError({ message: t('client.errors.notFound') });
    }

    const linkedVendorUid =
      invitation.linkedVendorUid && invitation.role === ROLES.VENDOR
        ? invitation.linkedVendorUid.toString()
        : undefined;

    return { invitation, client, linkedVendorUid };
  }

  /**
   * Handle user creation or linking based on existence (delegated to UserService)
   */
  private async processUserForInvitation(
    invitation: IInvitationDocument,
    invitationData: IInvitationAcceptance,
    client: any,
    cuid: string,
    linkedVendorUid?: string,
    session?: any
  ): Promise<any> {
    return await this.userService.processUserForClientInvitation(
      invitation,
      invitationData,
      {
        id: client.id.toString(),
        cuid,
        displayName: client.displayName || client.companyProfile?.legalEntityName,
      },
      linkedVendorUid,
      session
    );
  }

  /**
   * Complete invitation acceptance and initialize role info
   */
  private async finalizeInvitationAcceptance(
    result: { user: any; invitation: IInvitationDocument },
    cuid: string
  ): Promise<void> {
    const metadata = {
      employeeInfo: result.invitation.metadata?.employeeInfo,
      vendorInfo: result.invitation.metadata?.vendorInfo,
    };

    await this.profileService.initializeRoleInfo(
      result.user._id.toString(),
      cuid,
      result.invitation.role,
      result.invitation.linkedVendorUid?.toString(),
      metadata
    );

    if (result.invitation.linkedVendorUid && result.invitation.role === ROLES.VENDOR) {
      this.log.info(
        `Vendor link established from primary vendor ${result.invitation.linkedVendorUid} to new user ${result.user._id}`
      );
    }

    if (result.invitation.role === 'tenant') {
      await this.maybeCreateTenantPaymentCustomer(result.user, result.invitation, cuid);
    }
  }

  private async maybeCreateTenantPaymentCustomer(
    user: any,
    invitation: IInvitationDocument,
    cuid: string
  ): Promise<void> {
    try {
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor || !paymentProcessor.chargesEnabled) {
        this.log.info(
          { cuid },
          'PM has no active payment processor — skipping tenant Stripe customer creation'
        );
        return;
      }

      const result = await this.paymentGatewayService.createCustomer({
        provider: IPaymentGatewayProvider.STRIPE,
        email: user.email,
        name: invitation.inviteeFullName || user.email,
        connectedAccountId: paymentProcessor.accountId,
      });

      if (!result.success || !result.data) {
        this.log.warn(
          { cuid, userId: user._id },
          'Stripe customer creation returned no data for tenant — skipping'
        );
        return;
      }

      // Initialize tenantInfo if null — MongoDB cannot set nested paths through null
      await this.profileDAO.update(
        { user: user._id, tenantInfo: null },
        { $set: { tenantInfo: {} } }
      );

      await this.profileDAO.update(
        { user: user._id },
        {
          $set: {
            [`tenantInfo.paymentGatewayCustomers.${paymentProcessor.accountId}`]:
              result.data.customerId,
          },
        }
      );

      this.log.info(
        { cuid, userId: user._id, customerId: result.data.customerId },
        'Tenant Stripe customer created and stored on profile'
      );
    } catch (error) {
      // Do not throw — invitation acceptance must succeed even if customer creation fails
      this.log.error(
        { error, cuid, userId: user._id },
        'Error creating Stripe customer for tenant — invitation accepted without customer record'
      );
    }
  }

  async acceptInvitation(
    cuid: string,
    invitationData: IInvitationAcceptance
  ): Promise<ISuccessReturnData<{ user: any; invitation: IInvitationDocument }>> {
    const { invitation, client, linkedVendorUid } = await this.validateInvitationAndClient(
      cuid,
      invitationData.token
    );

    const session = await this.invitationDAO.startSession();
    const result = await this.invitationDAO.withTransaction(session, async (session) => {
      const user = await this.processUserForInvitation(
        invitation,
        invitationData,
        client,
        cuid,
        linkedVendorUid,
        session
      );

      if (!user) {
        throw new BadRequestError({ message: 'Error creating user account.' });
      }

      await this.invitationDAO.acceptInvitation(invitationData.token, user._id.toString(), session);

      // this fixes issue where leases created using invitationId as userId cause the userid hadn't been generated when the leases are created
      if (invitation.role === 'tenant') {
        await this.migrateLeasesFromInvitationToUser(invitation._id, user._id, session);
      }

      return { user, invitation };
    });

    await this.finalizeInvitationAcceptance(result, cuid);

    // Record explicit consent on the user document when provided via the invitation acceptance consent step
    if (invitationData.firstName || invitationData.lastName) {
      const acceptedBy =
        `${invitationData.firstName ?? ''} ${invitationData.lastName ?? ''}`.trim();
      await this.userDAO.update(
        { _id: result.user._id },
        { $set: { consent: { acceptedOn: new Date(), acceptedBy } } }
      );
    }

    // Emit invitation accepted event for seat tracking (only for employee roles)
    if (client) {
      this.emitterService.emit(EventTypes.INVITATION_ACCEPTED, {
        invitationId: invitation._id.toString(),
        inviteeEmail: invitation.inviteeEmail,
        clientId: client.id,
        role: invitation.role,
        cuid,
      });
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

    // Emit invitation revoked event for seat tracking (only for employee roles)
    const client = await this.clientDAO.findFirst({ _id: new Types.ObjectId(invitation.clientId) });
    if (client) {
      this.emitterService.emit(EventTypes.INVITATION_REVOKED, {
        invitationId: invitation._id.toString(),
        inviteeEmail: invitation.inviteeEmail,
        clientId: invitation.clientId.toString(),
        role: invitation.role,
        cuid: client.cuid,
      });
    }

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

      // If the draft has expired, extend it rather than blocking — resend is a reactivation
      if (invitation.expiresAt <= new Date()) {
        const newExpiresAt = dayjs().add(1, 'day').toDate();
        await this.invitationDAO.update(
          { _id: invitation._id },
          { $set: { expiresAt: newExpiresAt } }
        );
        invitation.expiresAt = newExpiresAt;
      }

      const [client, resender] = await Promise.all([
        this.clientDAO.findFirst({ _id: new Types.ObjectId(invitation.clientId) }),
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
          customMessage: validatedData.customMessage || invitation.metadata?.inviteMessage || '',
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

      const emailQueue = this.queueFactory.getQueue('emailQueue') as EmailQueue;
      emailQueue.addToEmailQueue(JOB_NAME.INVITATION_JOB, {
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
    // Lookup client by cuid to get clientId for querying
    const client = await this.clientDAO.getClientByCuid(query.cuid);
    if (!client) {
      throw new NotFoundError({ message: t('client.errors.notFound') });
    }

    // Add clientId to query for DAO
    const queryWithClientId = { ...query, clientId: client.id.toString() };
    const result = await this.invitationDAO.getInvitationsByClient(queryWithClientId);

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
      const expiredInvitations = await this.invitationDAO.list(
        {
          status: { $in: ['pending', 'sent'] },
          expiresAt: { $lte: new Date() },
        },
        { limit: 1000 }
      );

      const expiredCount = await this.invitationDAO.expireInvitations();

      // Emit events for each expired invitation (for seat tracking)
      for (const invitation of expiredInvitations.items) {
        try {
          const client = await this.clientDAO.findFirst({
            _id: new Types.ObjectId(invitation.clientId),
          });
          if (client) {
            this.emitterService.emit(EventTypes.INVITATION_EXPIRED, {
              invitationId: invitation._id.toString(),
              inviteeEmail: invitation.inviteeEmail,
              clientId: invitation.clientId.toString(),
              role: invitation.role,
              cuid: client.cuid,
            });
          }
        } catch (eventError) {
          this.log.error('Error emitting invitation expired event:', eventError);
          // Continue processing other invitations
        }
      }

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
      ROLE_GROUPS.MANAGEMENT_ROLES.includes(role as any)
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

      const invitationQueue = this.queueFactory.getQueue('invitationQueue') as InvitationQueue;
      const job = await invitationQueue.addCsvValidationJob(jobData);

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

      const invitationQueue = this.queueFactory.getQueue('invitationQueue') as InvitationQueue;
      const job = await invitationQueue.addCsvBulkUserValidationJob(jobData);

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

      const invitationQueue = this.queueFactory.getQueue('invitationQueue') as InvitationQueue;
      const job = await invitationQueue.addCsvImportJob(jobData);

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

      const invitationQueue = this.queueFactory.getQueue('invitationQueue') as InvitationQueue;
      const job = await invitationQueue.addCsvBulkUserImportJob(jobData);

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
      // Lookup client by cuid to get clientId for querying
      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        throw new NotFoundError({ message: t('client.errors.notFound') });
      }

      const query: IInvitationListQuery = {
        cuid,
        clientId: client.id.toString(),
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

  private readonly onEmailSent = this.handleEmailSent.bind(this);
  private readonly onEmailFailed = this.handleEmailFailed.bind(this);

  private setupEventListeners(): void {
    this.emitterService.on(EventTypes.EMAIL_SENT, this.onEmailSent);
    this.emitterService.on(EventTypes.EMAIL_FAILED, this.onEmailFailed);
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

  /**
   * Migrate leases from invitation ID to user ID when tenant accepts invitation
   * @param invitationId - The invitation ObjectId that was used as temporary tenantId
   * @param userId - The new user ObjectId to replace the invitation ID
   * @param session - MongoDB session for transaction
   */
  private async migrateLeasesFromInvitationToUser(
    invitationId: any,
    userId: any,
    session: any
  ): Promise<void> {
    try {
      const updateResult = await this.leaseDAO.updateMany(
        {
          tenantId: invitationId,
          useInvitationIdAsTenantId: true,
        },
        {
          $set: {
            tenantId: userId,
            useInvitationIdAsTenantId: false,
          },
        },
        session
      );

      if (updateResult.modifiedCount === 0) {
        this.log.info('No leases found to migrate from invitation', {
          invitationId: invitationId.toString(),
        });
        return;
      }

      this.log.info('Leases migrated successfully', {
        count: updateResult.modifiedCount,
        invitationId: invitationId.toString(),
        userId: userId.toString(),
      });
    } catch (error) {
      this.log.error('Error migrating leases from invitation to user', {
        error: error instanceof Error ? error.message : 'Unknown error',
        invitationId: invitationId.toString(),
        userId: userId.toString(),
      });
      // don't throw - let invitation acceptance succeed even if lease migration fails
    }
  }

  destroy(): void {
    this.emitterService.off(EventTypes.EMAIL_SENT, this.onEmailSent);
    this.emitterService.off(EventTypes.EMAIL_FAILED, this.onEmailFailed);
  }
}
