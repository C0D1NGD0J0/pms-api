import Logger from 'bunyan';
import { t } from '@shared/languages';
import { JOB_NAME } from '@utils/index';
import ProfileDAO from '@dao/profileDAO';
import { EmailQueue } from '@queues/index';
import { envVariables } from '@shared/config';
import { QueueFactory } from '@services/queue';
import { AuthCache } from '@caching/auth.cache';
import { SSEService } from '@services/sse/sse.service';
import { ClientValidations } from '@shared/validations';
import { EventEmitterService } from '@services/eventEmitter';
import { getRequestDuration, createLogger } from '@utils/index';
import { EmployeeDepartment } from '@interfaces/profile.interface';
import { IClientDocument, IClientStats } from '@interfaces/client.interface';
import { IPaymentGatewayProvider } from '@interfaces/subscription.interface';
import { IIdentitySessionResponse } from '@interfaces/paymentGateway.interface';
import { SubscriptionService } from '@services/subscription/subscription.service';
import { NotificationService } from '@services/notification/notification.service';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import { subscriptionPlanConfig } from '@services/subscription/subscription_plans.config';
import { ISuccessReturnData, IRequestContext, MailType } from '@interfaces/utils.interface';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors/index';
import { SubscriptionDAO, PropertyUnitDAO, PropertyDAO, ClientDAO, UserDAO } from '@dao/index';
import { IUserRoleType, RoleHelpers, IUserRole, ROLES } from '@shared/constants/roles.constants';
import {
  NotificationPriorityEnum,
  NotificationTypeEnum,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';
import {
  PaymentDisputeReversalFailedPayload,
  PaymentProcessorVerifiedPayload,
  PaymentDisputeCreatedPayload,
  PaymentDisputeLostPayload,
  PaymentDisputeWonPayload,
  EventTypes,
} from '@interfaces/events.interface';

interface IConstructor {
  paymentGatewayService: PaymentGatewayService;
  subscriptionService: SubscriptionService;
  notificationService: NotificationService;
  emitterService: EventEmitterService;
  subscriptionDAO: SubscriptionDAO;
  propertyUnitDAO: PropertyUnitDAO;
  queueFactory: QueueFactory;
  propertyDAO: PropertyDAO;
  profileDAO: ProfileDAO;
  sseService: SSEService;
  clientDAO: ClientDAO;
  authCache: AuthCache;
  userDAO: UserDAO;
}

export class ClientService {
  private readonly log: Logger;
  private readonly clientDAO: ClientDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly userDAO: UserDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly authCache: AuthCache;
  private readonly sseService: SSEService;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly subscriptionService: SubscriptionService;
  private readonly notificationService: NotificationService;
  private readonly emitterService: EventEmitterService;
  private readonly paymentGatewayService: PaymentGatewayService;
  private readonly queueFactory: QueueFactory;

  constructor({
    clientDAO,
    propertyDAO,
    propertyUnitDAO,
    userDAO,
    profileDAO,
    authCache,
    sseService,
    subscriptionDAO,
    subscriptionService,
    notificationService,
    emitterService,
    paymentGatewayService,
    queueFactory,
  }: IConstructor) {
    this.log = createLogger('ClientService');
    this.clientDAO = clientDAO;
    this.propertyDAO = propertyDAO;
    this.propertyUnitDAO = propertyUnitDAO;
    this.emitterService = emitterService;
    this.userDAO = userDAO;
    this.profileDAO = profileDAO;
    this.authCache = authCache;
    this.sseService = sseService;
    this.subscriptionDAO = subscriptionDAO;
    this.notificationService = notificationService;
    this.subscriptionService = subscriptionService;
    this.paymentGatewayService = paymentGatewayService;
    this.queueFactory = queueFactory;
    this.setupEventListeners();
  }

  async updateClientDetails(
    cxt: IRequestContext,
    updateData: Partial<IClientDocument>
  ): Promise<ISuccessReturnData<IClientDocument>> {
    const currentuser = cxt.currentuser!;
    const start = process.hrtime.bigint();
    const { cuid } = cxt.request.params;

    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client) {
      this.log.error(
        {
          cuid,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          data: JSON.stringify(updateData),
          duration: getRequestDuration(start).durationInMs,
        },
        t('client.errors.notFound')
      );
      throw new NotFoundError({ message: t('client.errors.notFound') });
    }

    const validationErrors: string[] = [];
    let requiresReVerification = false;

    const isValidEmail = (email: string): boolean => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(email);
    };

    if (updateData.dataProcessingConsent === false) {
      requiresReVerification = true;
    }

    if (updateData.companyProfile) {
      if (
        updateData.companyProfile.companyEmail &&
        !isValidEmail(updateData.companyProfile.companyEmail)
      ) {
        validationErrors.push(t('client.validation.invalidEmailFormat'));
      }

      if (
        updateData.companyProfile.legalEntityName &&
        updateData.companyProfile.legalEntityName !== client.companyProfile?.legalEntityName
      ) {
        requiresReVerification = true;
      }
      if (
        updateData.companyProfile.registrationNumber &&
        updateData.companyProfile.registrationNumber !== client.companyProfile?.registrationNumber
      ) {
        requiresReVerification = true;
      }
    }

    if (updateData.displayName) {
      if (updateData.displayName.trim().length === 0) {
        validationErrors.push(t('client.validation.displayNameEmpty'));
      }
      if (updateData.displayName !== client.displayName) {
        requiresReVerification = true;
      }
    }

    if (requiresReVerification) {
      updateData.isVerified = false;
    }

    if (client.accountType?.isEnterpriseAccount) {
      const mergedCompanyProfile = {
        ...client.companyProfile,
        ...updateData.companyProfile,
      };

      try {
        ClientValidations.enterpriseValidation.parse({
          companyProfile: mergedCompanyProfile,
        });
      } catch (error: any) {
        const enterpriseErrors: string[] = [];
        if (error.errors) {
          error.errors.forEach((err: any) => {
            enterpriseErrors.push(err.message);
          });
        }

        if (enterpriseErrors.length > 0) {
          throw new BadRequestError({
            message: 'Enterprise clients must have complete company profile information',
          });
        }
      }
    }

    const changedFields = Object.keys(updateData);
    this.log.info(
      {
        cuid,
        userId: currentuser.sub,
        requestId: cxt.requestId,
        changedFields: JSON.stringify(changedFields),
        requiresReVerification,
      },
      t('client.logging.validationCompleted')
    );

    if (validationErrors.length > 0) {
      this.log.error(
        {
          cuid,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          validationErrors,
          duration: getRequestDuration(start).durationInMs,
        },
        t('client.logging.validationFailed')
      );
      throw new BadRequestError({
        message: t('client.errors.validationFailed'),
        errorInfo: { validationErrors },
      });
    }

    const session = await this.clientDAO.startSession();
    const result = await this.clientDAO.withTransaction(session, async (session) => {
      delete updateData.accountAdmin;
      delete updateData.accountType;
      delete updateData.isVerified;
      delete updateData.cuid;
      const updatedClient = await this.clientDAO.updateById(
        client._id.toString(),
        {
          $set: {
            ...updateData,
            lastModifiedBy: currentuser.sub,
          },
        },
        undefined,
        session
      );
      if (!updatedClient) {
        this.log.error(
          {
            cuid,
            url: cxt.request.url,
            userId: currentuser?.sub,
            requestId: cxt.requestId,
            data: JSON.stringify(updateData),
            duration: getRequestDuration(start).durationInMs,
          },
          t('client.logging.updateFailed')
        );
        throw new BadRequestError({ message: t('client.errors.updateFailed') });
      }

      return { updatedClient };
    });

    return {
      success: true,
      data: result.updatedClient,
      message: t('client.success.updated'),
    };
  }

  async getClientDetails(
    cxt: IRequestContext
  ): Promise<ISuccessReturnData<{ clientStats: IClientStats } & IClientDocument>> {
    const currentuser = cxt.currentuser!;
    const start = process.hrtime.bigint();
    const { cuid } = cxt.request.params;
    if (!cuid) {
      this.log.error(
        {
          cuid,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        t('client.logging.missingParameters')
      );
      throw new BadRequestError({ message: t('client.errors.fetchFailed') });
    }

    const [client, usersResult, propertiesResult, subscription] = await Promise.all([
      this.clientDAO.getClientByCuid(cuid, {
        populate: {
          path: 'accountAdmin',
          select: 'email',
          populate: {
            path: 'profile',
            select:
              'personalInfo.firstName personalInfo.lastName personalInfo.phoneNumber personalInfo.avatar',
          },
        },
        limit: 1,
        skip: 0,
      }),
      this.userDAO.getUsersByClientId(cuid, {}, { limit: 1000, skip: 0 }),
      this.propertyDAO.countDocuments({ cuid, deletedAt: null }),
      this.subscriptionDAO.findFirst({ cuid }),
    ]);

    if (!client) {
      this.log.error(
        {
          cuid,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        t('client.logging.detailsNotFound')
      );
      throw new NotFoundError({ message: t('client.errors.detailsNotFound') });
    }

    const responseData: any = {
      cuid: client.cuid,
      displayName: client.displayName,
      isVerified: client.isVerified,
      accountType: {
        category:
          client.accountType.category ||
          (client.accountType.isEnterpriseAccount ? 'business' : 'individual'),
        plan: subscription?.planName || 'essential',
        billingInterval: subscription?.billingInterval || 'monthly',
      },
      accountAdmin: {
        email: (client.accountAdmin as any)?.email || '',
        id: (client.accountAdmin as any)?._id?.toString() || '',
        firstName: (client.accountAdmin as any)?.profile?.personalInfo?.firstName || '',
        lastName: (client.accountAdmin as any)?.profile?.personalInfo?.lastName || '',
        phoneNumber: (client.accountAdmin as any)?.profile?.personalInfo?.phoneNumber || '',
        avatar: (client.accountAdmin as any)?.profile?.personalInfo?.avatar || '',
      },
      settings: {
        notificationPreferences: client.settings.notificationPreferences,
        timeZone: client.settings.timeZone,
        lang: client.settings.lang,
      },
      clientStats: {
        totalProperties: propertiesResult,
        totalUsers: usersResult.pagination?.total || 0,
      },
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    };

    responseData.dataProcessingConsent = client.dataProcessingConsent;
    responseData.identityVerification = client.identityVerification;

    if (client.accountType.isEnterpriseAccount && client.companyProfile) {
      responseData.companyProfile = {
        legalEntityName: client.companyProfile.legalEntityName,
        tradingName: client.companyProfile.tradingName,
        website: client.companyProfile.website,
        industry: client.companyProfile.industry,
      };
    }

    const isSuperAdmin = currentuser.client?.role === 'super-admin';
    if (isSuperAdmin && subscription) {
      const unitCount = await this.propertyUnitDAO.countDocuments({ cuid, deletedAt: null });
      const billingHistory = await this.subscriptionService.getBillingHistory(cuid);
      const config = subscriptionPlanConfig.getConfig(subscription.planName);

      responseData.subscription = {
        subscriptionId: subscription._id.toString(),
        suid: subscription.suid,
        cuid: subscription.cuid,
        planName: subscription.planName,
        status: subscription.status,
        billingInterval: subscription.billingInterval,
        amount: subscription.totalMonthlyPrice,
        nextBillingDate: subscription.endDate,
        canceledAt: subscription.canceledAt || null,
        pendingDowngradeAt: subscription.pendingDowngradeAt || null,
        currentSeats: subscription.currentSeats,
        currentProperties: propertiesResult,
        currentUnits: unitCount,
        seatInfo: {
          includedSeats: config.seatPricing.includedSeats,
          additionalSeats: subscription.additionalSeatsCount,
          totalAvailable: config.seatPricing.includedSeats + subscription.additionalSeatsCount,
          maxAdditionalSeats: config.seatPricing.maxAdditionalSeats,
          availableForPurchase:
            config.seatPricing.maxAdditionalSeats - subscription.additionalSeatsCount,
          additionalSeatCost: subscription.additionalSeatsCost,
        },
        paymentMethod: subscription.billing?.cardLast4
          ? {
              last4: subscription.billing.cardLast4,
              brand: subscription.billing.cardBrand,
            }
          : null,
        billingHistory,
      };
    }

    return {
      success: true,
      message: t('client.success.retrieved'),
      data: responseData,
    };
  }

  async assignUserRole(
    cxt: IRequestContext,
    targetUserId: string,
    role: IUserRoleType
  ): Promise<ISuccessReturnData> {
    const currentuser = cxt.currentuser!;
    const clientId = currentuser.client.cuid;

    if (!Object.values(IUserRole).includes(role as IUserRole)) {
      throw new BadRequestError({ message: t('client.errors.invalidRole') });
    }

    const user = await this.userDAO.getUserById(targetUserId);
    if (!user) {
      throw new NotFoundError({ message: t('client.errors.userNotFound') });
    }

    const clientConnection = user.cuids.find((c) => c.cuid === clientId);
    if (!clientConnection) {
      throw new NotFoundError({ message: t('client.errors.userNotInClient') });
    }

    if (clientConnection.roles.includes(role as IUserRole)) {
      throw new BadRequestError({ message: t('client.errors.userAlreadyHasRole', { role }) });
    }

    await this.userDAO.updateById(
      targetUserId,
      {
        $addToSet: { 'cuids.$[elem].roles': role },
      },
      {
        arrayFilters: [{ 'elem.cuid': clientId }],
      }
    );

    this.log.info(
      {
        adminId: currentuser.sub,
        targetUserId,
        clientId,
        role,
        action: 'assignRole',
      },
      t('client.logging.roleAssigned')
    );

    return {
      success: true,
      data: null,
      message: t('client.success.roleAssigned', { role }),
    };
  }

  async removeUserRole(
    cxt: IRequestContext,
    targetUserId: string,
    role: IUserRoleType
  ): Promise<ISuccessReturnData> {
    const currentuser = cxt.currentuser!;
    const clientId = currentuser.client.cuid;

    if (role === ROLES.ADMIN) {
      const adminUsers = await this.userDAO.list({
        cuids: {
          $elemMatch: {
            cuid: clientId,
            roles: ROLES.ADMIN,
            isConnected: true,
          },
        },
        deletedAt: null,
        isActive: true,
      });

      if (adminUsers.items.length <= 1) {
        throw new ForbiddenError({ message: t('client.errors.cannotRemoveLastAdmin') });
      }
    }

    await this.userDAO.updateById(
      targetUserId,
      {
        $pull: { 'cuids.$[elem].roles': role },
      },
      {
        arrayFilters: [{ 'elem.cuid': clientId }],
      }
    );

    this.log.info(
      {
        adminId: currentuser.sub,
        targetUserId,
        clientId,
        role,
        action: 'removeRole',
      },
      t('client.logging.roleRemoved')
    );

    return {
      success: true,
      data: null,
      message: t('client.success.roleRemoved', { role }),
    };
  }

  async getUserRoles(
    cxt: IRequestContext,
    targetUserId: string
  ): Promise<ISuccessReturnData<{ roles: IUserRoleType[] }>> {
    const currentuser = cxt.currentuser!;
    const clientId = currentuser.client.cuid;

    const user = await this.userDAO.getUserById(targetUserId);
    if (!user) {
      throw new NotFoundError({ message: t('client.errors.userNotFound') });
    }

    const clientConnection = user.cuids.find((c) => c.cuid === clientId);
    if (!clientConnection) {
      throw new NotFoundError({ message: t('client.errors.userNotInClient') });
    }

    return {
      success: true,
      data: { roles: clientConnection.roles },
      message: t('client.success.rolesRetrieved'),
    };
  }

  async disconnectUser(cxt: IRequestContext, targetUserId: string): Promise<ISuccessReturnData> {
    const currentuser = cxt.currentuser!;
    const clientId = currentuser.client.cuid;

    const user = await this.userDAO.getUserById(targetUserId);
    if (!user) {
      throw new NotFoundError({ message: t('client.errors.userNotFound') });
    }

    const clientConnection = user.cuids.find((c) => c.cuid === clientId);
    if (!clientConnection) {
      throw new NotFoundError({ message: t('client.errors.userNotInClient') });
    }

    if (clientConnection.roles.includes(IUserRole.ADMIN)) {
      const connectedAdmins = await this.userDAO.list({
        cuids: {
          $elemMatch: {
            cuid: clientId,
            roles: ROLES.ADMIN,
            isConnected: true,
          },
        },
        deletedAt: null,
        isActive: true,
      });

      if (connectedAdmins.items.length <= 1) {
        throw new ForbiddenError({ message: t('client.errors.cannotDisconnectLastAdmin') });
      }
    }

    await this.userDAO.updateById(
      targetUserId,
      {
        $set: { 'cuids.$[elem].isConnected': false },
      },
      {
        arrayFilters: [{ 'elem.cuid': clientId }],
      }
    );

    // Kill the user's session for this client immediately
    this.emitterService.emit(EventTypes.USER_DISCONNECTED, {
      disconnectedBy: currentuser.sub,
      userId: user._id.toString(),
      uid: user.uid,
      cuid: clientId,
    });

    // Emit event for subscription seat tracking (employee roles only)
    const EMPLOYEE_ROLES = ['super-admin', 'admin', 'manager', 'staff'];
    const isEmployee = clientConnection.roles.some((role) => EMPLOYEE_ROLES.includes(role));

    if (isEmployee) {
      this.emitterService.emit(EventTypes.USER_ARCHIVED, {
        userId: user._id.toString(),
        cuid: clientId,
        roles: clientConnection.roles,
        archivedBy: currentuser.uid,
        createdAt: new Date(),
      });

      this.log.info('USER_ARCHIVED event emitted for seat tracking', {
        userId: targetUserId,
        cuid: clientId,
        roles: clientConnection.roles,
      });
    }

    // Send disconnection notification to the affected user
    try {
      const client = await this.clientDAO.getClientByCuid(clientId);
      const emailQueue = this.queueFactory.getQueue('emailQueue') as EmailQueue;
      emailQueue.addToEmailQueue(JOB_NAME.ACCOUNT_DISCONNECTED_JOB, {
        to: user.email,
        subject: 'Your Account Connection Has Been Removed',
        emailType: MailType.ACCOUNT_DISCONNECTED,
        client: { cuid: clientId, id: client?._id.toString() || '' },
        data: {
          fullname: user.email,
          companyName:
            client?.displayName ||
            (client as any)?.companyProfile?.legalEntityName ||
            'your account',
          disconnectedAt: new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }),
          roles: clientConnection.roles.join(', '),
        },
      });
    } catch (emailError) {
      this.log.error('Failed to queue disconnection email', {
        targetUserId,
        error: emailError,
      });
    }

    this.log.info(
      {
        adminId: currentuser.sub,
        targetUserId,
        clientId,
        action: 'disconnectUser',
      },
      t('client.logging.userDisconnected')
    );

    return {
      success: true,
      data: null,
      message: t('client.success.userDisconnected'),
    };
  }

  async reconnectUser(cxt: IRequestContext, targetUserId: string): Promise<ISuccessReturnData> {
    const currentuser = cxt.currentuser!;
    const clientId = currentuser.client.cuid;

    await this.userDAO.updateById(
      targetUserId,
      {
        $set: { 'cuids.$[elem].isConnected': true },
      },
      {
        arrayFilters: [{ 'elem.cuid': clientId }],
      }
    );

    this.log.info(
      {
        adminId: currentuser.sub,
        targetUserId,
        clientId,
        action: 'reconnectUser',
      },
      t('client.logging.userReconnected')
    );

    return {
      success: true,
      data: null,
      message: t('client.success.userReconnected'),
    };
  }

  /**
   * Assign a department to a user (employee roles only)
   * Departments provide fine-grained permission control within employee roles
   */
  async assignDepartment(
    cxt: IRequestContext,
    targetUserId: string,
    department: EmployeeDepartment
  ): Promise<ISuccessReturnData<{ department: EmployeeDepartment }>> {
    const currentuser = cxt.currentuser!;
    const clientId = currentuser.client.cuid;

    // Get user and validate
    const user = await this.userDAO.getUserById(targetUserId);
    if (!user) {
      throw new NotFoundError({ message: t('client.errors.userNotFound') });
    }

    const clientConnection = user.cuids.find((c) => c.cuid === clientId);
    if (!clientConnection) {
      throw new NotFoundError({ message: t('client.errors.userNotInClient') });
    }

    // Validate user is an employee
    const roles = clientConnection.roles;
    if (!RoleHelpers.isEmployeeRole(roles[0])) {
      throw new BadRequestError({
        message: 'Departments can only be assigned to employee roles (admin/manager/staff)',
      });
    }

    // Get profile
    const profile = await this.profileDAO.getProfileByUserId(user._id);
    if (!profile) {
      throw new NotFoundError({ message: 'User profile not found' });
    }

    await this.profileDAO.updateCommonEmployeeInfo(profile._id.toString(), {
      department: department,
    });
    await this.authCache.invalidateUserSession(user._id.toString(), clientId);

    this.log.info(
      {
        adminId: currentuser.sub,
        targetUserId,
        clientId,
        department,
        action: 'assignDepartment',
      },
      'Department assigned to user'
    );

    return {
      success: true,
      data: { department },
      message: `Department '${department}' assigned successfully`,
    };
  }

  async verifyAccount(cxt: IRequestContext): Promise<ISuccessReturnData<{ isVerified: boolean }>> {
    const currentuser = cxt.currentuser!;
    const start = process.hrtime.bigint();
    const { cuid } = cxt.request.params;

    // Fetch client
    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client) {
      this.log.error(
        {
          cuid,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        t('client.errors.notFound')
      );
      throw new NotFoundError({ message: t('client.errors.notFound') });
    }

    // Check if already verified
    if (client.isVerified) {
      this.log.warn(
        {
          cuid,
          userId: currentuser.sub,
          requestId: cxt.requestId,
        },
        'Account is already verified'
      );
      throw new BadRequestError({ message: 'Account is already verified' });
    }

    // Update client to verified status
    const updatedClient = await this.clientDAO.updateById(client._id.toString(), {
      $set: {
        isVerified: true,
        'identityVerification.verifiedAt': new Date(),
        'identityVerification.verifiedBy': currentuser.sub,
      },
    });

    if (!updatedClient) {
      this.log.error(
        {
          cuid,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Failed to update client verification status'
      );
      throw new BadRequestError({ message: 'Failed to verify account' });
    }

    this.log.info(
      {
        cuid,
        userId: currentuser.sub,
        requestId: cxt.requestId,
        duration: getRequestDuration(start).durationInMs,
      },
      'Account verified successfully'
    );

    return {
      success: true,
      data: { isVerified: true },
      message: t('client.success.verified'),
    };
  }

  async initiateIdentityVerification(
    cxt: IRequestContext
  ): Promise<ISuccessReturnData<IIdentitySessionResponse>> {
    const currentuser = cxt.currentuser!;
    const { cuid } = cxt.request.params;

    if (currentuser.client.role !== ROLES.SUPER_ADMIN) {
      throw new ForbiddenError({ message: t('auth.errors.superAdminRequired') });
    }

    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client) throw new NotFoundError({ message: t('client.errors.notFound') });
    if (client.isVerified)
      throw new BadRequestError({ message: t('client.errors.alreadyVerified') });

    const returnUrl = `${envVariables.FRONTEND.URL}/client/${cuid}/account_settings`;

    const { data, success } = await this.paymentGatewayService.createIdentityVerificationSession(
      IPaymentGatewayProvider.STRIPE,
      {
        email: currentuser.email,
        metadata: { cuid, userId: currentuser.sub },
        returnUrl,
      }
    );

    if (!success || !data) {
      throw new BadRequestError({ message: t('client.errors.identitySessionFailed') });
    }

    await this.clientDAO.updateById(client._id.toString(), {
      $set: {
        'identityVerification.sessionId': data.sessionId,
        'identityVerification.sessionStatus': 'requires_input',
      },
    });

    this.log.info({ cuid, sessionId: data.sessionId }, 'Identity verification session created');
    return { success: true, data };
  }

  async handleIdentityWebhookEvent(
    status: 'verified' | 'requires_input',
    sessionId: string
  ): Promise<void> {
    const client = await this.clientDAO.findFirst({
      'identityVerification.sessionId': sessionId,
    });
    if (!client) {
      this.log.warn({ sessionId }, 'No client found for identity webhook session');
      return;
    }

    if (status === 'verified') {
      const { data: report } = await this.paymentGatewayService.retrieveIdentityVerificationSession(
        IPaymentGatewayProvider.STRIPE,
        sessionId
      );

      await this.clientDAO.updateById(client._id.toString(), {
        $set: {
          isVerified: true,
          'identityVerification.sessionStatus': 'stripe_verified',
          'identityVerification.documentType': report?.documentType,
          'identityVerification.issuingCountry': report?.issuingCountry,
          'identityVerification.verifiedAt': new Date(),
        },
      });

      this.sseService.sendToUser(client.accountAdmin.toString(), EventTypes.IDENTITY_VERIFIED, {
        cuid: client.cuid,
        isVerified: true,
      });
    } else {
      await this.clientDAO.updateById(client._id.toString(), {
        $set: { 'identityVerification.sessionStatus': 'requires_input' },
      });

      this.sseService.sendToUser(
        client.accountAdmin.toString(),
        EventTypes.IDENTITY_REQUIRES_INPUT,
        { cuid: client.cuid, sessionStatus: 'requires_input' }
      );
    }
  }

  // ── Payment event listeners ───────────────────────────────────────────────

  private setupEventListeners(): void {
    this.emitterService.on(
      EventTypes.PAYMENT_PROCESSOR_VERIFIED,
      this.handlePaymentProcessorVerified.bind(this)
    );
    this.emitterService.on(
      EventTypes.PAYMENT_DISPUTE_CREATED,
      this.handleDisputeCreated.bind(this)
    );
    this.emitterService.on(EventTypes.PAYMENT_DISPUTE_WON, this.handleDisputeWon.bind(this));
    this.emitterService.on(EventTypes.PAYMENT_DISPUTE_LOST, this.handleDisputeLost.bind(this));
    this.emitterService.on(
      EventTypes.PAYMENT_DISPUTE_REVERSAL_FAILED,
      this.handleDisputeReversalFailed.bind(this)
    );
  }

  private async handlePaymentProcessorVerified({
    cuid,
    accountId,
  }: PaymentProcessorVerifiedPayload): Promise<void> {
    try {
      const client = await this.clientDAO.findFirst({ cuid });
      const adminId = client?.accountAdmin?.toString();
      if (!adminId) {
        this.log.warn({ cuid }, 'No account admin found for payout verification notification');
        return;
      }

      await this.authCache.invalidateCurrentUser(adminId, cuid);

      await this.sseService.sendToUser(
        adminId,
        cuid,
        {
          action: 'REFETCH_CURRENT_USER',
          eventType: 'payout_account_verified',
          message: 'Your payout account has been verified and is ready to receive payments.',
          timestamp: new Date().toISOString(),
        },
        'payment_update'
      );

      await this.notificationService.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
        type: NotificationTypeEnum.PAYMENT,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        priority: NotificationPriorityEnum.HIGH,
        title: 'Payout Account Verified',
        message:
          'Your payout account has been verified. You can now receive rent payments directly to your bank account.',
        cuid,
        targetRoles: [ROLES.ADMIN],
        metadata: {},
      });

      this.log.info({ cuid, adminId, accountId }, 'Payout account verified — PM notified');
    } catch (error) {
      this.log.error({ error, cuid }, 'Failed to handle payment processor verified event');
    }
  }

  private async handleDisputeCreated({
    cuid,
    amount,
    currency,
    reason,
    disputeId,
    invoiceNumber,
    chargeId,
  }: PaymentDisputeCreatedPayload): Promise<void> {
    try {
      const amountFormatted = `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
      await this.notificationService.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
        type: NotificationTypeEnum.PAYMENT,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        priority: NotificationPriorityEnum.HIGH,
        title: 'Payment Dispute Opened',
        message: `A dispute of ${amountFormatted} was filed for invoice ${invoiceNumber}. The transfer has been reversed pending resolution.`,
        cuid,
        targetRoles: [ROLES.ADMIN, ROLES.MANAGER],
        metadata: { disputeId, chargeId, invoiceNumber, amount, currency, reason },
      });
    } catch (error) {
      this.log.error({ error, cuid }, 'Failed to handle dispute created event');
    }
  }

  private async handleDisputeWon({
    cuid,
    amount,
    currency,
    disputeId,
    invoiceNumber,
    chargeId,
  }: PaymentDisputeWonPayload): Promise<void> {
    try {
      const amountFormatted = `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
      await this.notificationService.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
        type: NotificationTypeEnum.PAYMENT,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        priority: NotificationPriorityEnum.MEDIUM,
        title: 'Dispute Resolved — Funds Returned',
        message: `The dispute for invoice ${invoiceNumber} was resolved in your favor. ${amountFormatted} has been re-transferred to your account.`,
        cuid,
        targetRoles: [ROLES.ADMIN, ROLES.MANAGER],
        metadata: { disputeId, chargeId, invoiceNumber, amount, currency },
      });
    } catch (error) {
      this.log.error({ error, cuid }, 'Failed to handle dispute won event');
    }
  }

  private async handleDisputeLost({
    cuid,
    amount,
    currency,
    disputeId,
    invoiceNumber,
    chargeId,
  }: PaymentDisputeLostPayload): Promise<void> {
    try {
      const amountFormatted = `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
      await this.notificationService.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
        type: NotificationTypeEnum.PAYMENT,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        priority: NotificationPriorityEnum.HIGH,
        title: 'Dispute Lost — Payouts Blocked',
        message: `The dispute for invoice ${invoiceNumber} was lost. ${amountFormatted} has been debited from the platform account. Payouts have been blocked pending review.`,
        cuid,
        targetRoles: [ROLES.ADMIN, ROLES.MANAGER],
        metadata: { disputeId, chargeId, invoiceNumber, amount, currency },
      });
    } catch (error) {
      this.log.error({ error, cuid }, 'Failed to handle dispute lost event');
    }
  }

  private async handleDisputeReversalFailed({
    cuid,
    disputeId,
    transferId,
    amount,
    currency,
  }: PaymentDisputeReversalFailedPayload): Promise<void> {
    try {
      const amountFormatted = `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
      await this.notificationService.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
        type: NotificationTypeEnum.PAYMENT,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        priority: NotificationPriorityEnum.HIGH,
        title: 'Dispute Transfer Reversal Failed — Payouts Blocked',
        message: `The transfer reversal for dispute ${disputeId} failed (${amountFormatted}). Payouts have been blocked automatically. Manual review required.`,
        cuid,
        targetRoles: [ROLES.ADMIN, ROLES.MANAGER],
        metadata: { disputeId, transferId, amount, currency },
      });
    } catch (error) {
      this.log.error({ error, cuid }, 'Failed to handle dispute reversal failed event');
    }
  }
}
