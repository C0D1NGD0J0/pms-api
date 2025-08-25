import Logger from 'bunyan';
import { t } from '@shared/languages';
import { DoneCallback, Job } from 'bull';
import { EmailQueue } from '@queues/index';
import { envVariables } from '@shared/config';
import { CsvJobData } from '@interfaces/index';
import { createLogger, JOB_NAME } from '@utils/index';
import { InvitationCsvProcessor } from '@services/csv';
import { MailType } from '@interfaces/utils.interface';
import { generateDefaultPassword } from '@utils/helpers';
import { EventTypes } from '@interfaces/events.interface';
import { IClientInfo } from '@interfaces/client.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { IInvitationData } from '@interfaces/invitation.interface';
import { InvitationDAO, ProfileDAO, ClientDAO, UserDAO } from '@dao/index';

interface IConstructor {
  invitationCsvProcessor: InvitationCsvProcessor;
  emitterService: EventEmitterService;
  invitationDAO: InvitationDAO;
  emailQueue: EmailQueue;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  profileService: any; // Add profile service
  userDAO: UserDAO;
}

export class InvitationWorker {
  log: Logger;
  private readonly emitterService: EventEmitterService;
  private readonly invitationCsvProcessor: InvitationCsvProcessor;
  private readonly invitationDAO: InvitationDAO;
  private readonly userDAO: UserDAO;
  private readonly clientDAO: ClientDAO;
  private readonly emailQueue: EmailQueue;
  private readonly profileDAO: ProfileDAO;
  private readonly profileService: any;

  constructor({
    emitterService,
    invitationCsvProcessor,
    invitationDAO,
    userDAO,
    clientDAO,
    emailQueue,
    profileDAO,
    profileService,
  }: IConstructor) {
    this.emitterService = emitterService;
    this.invitationCsvProcessor = invitationCsvProcessor;
    this.invitationDAO = invitationDAO;
    this.userDAO = userDAO;
    this.clientDAO = clientDAO;
    this.emailQueue = emailQueue;
    this.profileDAO = profileDAO;
    this.profileService = profileService;
    this.log = createLogger('InvitationWorker');
  }

  processCsvValidation = async (job: Job<CsvJobData>, done: DoneCallback) => {
    job.progress(10);
    const { csvFilePath, clientInfo, userId } = job.data;
    this.log.info(
      `Processing invitation CSV validation job ${job.id} for client ${clientInfo.cuid}`
    );

    try {
      job.progress(30);
      const result = await this.invitationCsvProcessor.validateCsv(csvFilePath, {
        userId,
        cuid: clientInfo.cuid,
      });
      job.progress(100);

      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);

      done(null, {
        processId: job.id,
        validCount: result.validInvitations.length,
        errorCount: result.errors ? result.errors.length : 0,
        errors: result.errors,
        success: true,
        totalRows: result.totalRows,
        finishedAt: result.finishedAt,
      });
      this.log.info(
        `Done processing invitation CSV validation job ${job.id} for client ${clientInfo.cuid}`
      );
    } catch (error) {
      this.log.error(`Error processing invitation CSV validation job ${job.id}:`, error);
      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);
      done(error, null);
    }
  };

  processCsvImport = async (job: Job<CsvJobData>, done: DoneCallback) => {
    const { csvFilePath, clientInfo, userId } = job.data;

    job.progress(10);
    this.log.info(`Processing invitation CSV import job ${job.id} for client ${clientInfo.cuid}`);

    try {
      const csvResult = await this.invitationCsvProcessor.validateCsv(csvFilePath, {
        userId,
        cuid: clientInfo.cuid,
      });
      job.progress(30);

      if (!csvResult.validInvitations.length) {
        this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);
        done(null, {
          success: false,
          processId: job.id,
          data: null,
          finishedAt: new Date(),
          errors: csvResult.errors,
          message: 'No valid invitations found in CSV',
        });
        return;
      }

      const results = [];
      let processed = 0;

      for (const invitationData of csvResult.validInvitations) {
        try {
          let result;

          if (invitationData.status === 'draft') {
            result = await this.createDraftInvitation(userId, clientInfo, invitationData);
            results.push({
              email: invitationData.inviteeEmail,
              success: true,
              invitationId: result.iuid,
              status: 'draft',
            });
          } else {
            result = await this.sendSingleInvitation(userId, clientInfo, invitationData);
            results.push({
              email: invitationData.inviteeEmail,
              success: true,
              invitationId: result.iuid,
              status: 'sent',
            });
          }
        } catch (error) {
          this.log.error(`Error processing invitation to ${invitationData.inviteeEmail}:`, error);
          results.push({
            email: invitationData.inviteeEmail,
            success: false,
            error: error.message,
          });
        }

        processed++;
        const progress = 30 + Math.floor((processed / csvResult.validInvitations.length) * 60);
        job.progress(progress);

        // delay to avoid rate limiting (2 seconds between emails)
        if (processed < csvResult.validInvitations.length) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      job.progress(100);

      const successCount = results.filter((r) => r.success).length;
      const failedCount = results.filter((r) => !r.success).length;

      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);

      done(null, {
        success: true,
        processId: job.id,
        data: {
          totalProcessed: results.length,
          successCount,
          failedCount,
          results,
        },
        finishedAt: new Date(),
        message: `Processed ${successCount} invitations successfully, ${failedCount} failed`,
      });

      this.log.info(
        `Done processing invitation CSV import job ${job.id} for client ${clientInfo.cuid}. Success: ${successCount}, Failed: ${failedCount}`
      );
    } catch (error) {
      this.log.error(`Error processing invitation CSV import job ${job.id}:`, error);
      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);
      done(error, null);
    }
  };

  /**
   * Send a single invitation (extracted from InvitationService to avoid cyclic dependency)
   */
  private async sendSingleInvitation(
    inviterUserId: string,
    clientInfo: IClientInfo,
    invitationData: IInvitationData
  ) {
    if (!clientInfo.cuid || !clientInfo.id) {
      throw new Error('Client not found');
    }

    // Validate linkedVendorId if provided for vendor role
    if (invitationData.linkedVendorId && invitationData.role === 'vendor') {
      const primaryVendor = await this.userDAO.getUserById(invitationData.linkedVendorId);
      if (!primaryVendor) {
        throw new Error('Primary vendor not found');
      }

      // Check if the referenced user is actually a primary vendor (no linkedVendorId)
      const vendorCuid = primaryVendor.cuids.find((c) => c.cuid === clientInfo.cuid);
      if (!vendorCuid || !vendorCuid.roles.includes('vendor' as any)) {
        throw new Error('Referenced user is not a vendor for this client');
      }

      if (vendorCuid.linkedVendorId) {
        throw new Error('Cannot link to a vendor that is already linked to another vendor');
      }
    }

    // Check for existing pending invitation
    const existingInvitation = await this.invitationDAO.findPendingInvitation(
      invitationData.inviteeEmail,
      clientInfo.id
    );

    if (existingInvitation) {
      throw new Error('A pending invitation already exists for this email');
    }

    // check if user already has access
    const existingUser = await this.userDAO.getUserWithClientAccess(
      invitationData.inviteeEmail,
      clientInfo.cuid
    );

    if (existingUser) {
      throw new Error('User already has access to this client');
    }

    const invitation = await this.invitationDAO.createInvitation(
      invitationData,
      inviterUserId,
      clientInfo.id
    );

    const inviter = await this.userDAO.getUserById(inviterUserId, {
      populate: 'profile',
    });

    const emailData = {
      to: invitationData.inviteeEmail,
      subject: t('email.invitation.subject', {
        companyName: clientInfo.clientDisplayName || 'Company',
      }),
      emailType: MailType.INVITATION,
      data: {
        inviteeName: `${invitationData.personalInfo.firstName} ${invitationData.personalInfo.lastName}`,
        inviterName: inviter?.profile?.fullname || inviter?.email || 'Team Member',
        companyName: clientInfo.clientDisplayName || 'Company',
        role: invitationData.role,
        invitationUrl: `${envVariables.FRONTEND.URL}/invite/${clientInfo.cuid}?token=${invitation.invitationToken}`,
        expiresAt: invitation.expiresAt,
        invitationId: invitation._id.toString(),
        customMessage: invitationData.metadata?.inviteMessage,
      },
    };
    this.emailQueue.addToEmailQueue(JOB_NAME.INVITATION_JOB, emailData);

    return invitation;
  }

  private async createDraftInvitation(
    inviterUserId: string,
    clientInfo: IClientInfo,
    invitationData: IInvitationData
  ) {
    if (!clientInfo.cuid || !clientInfo.id) {
      throw new Error('Client not found');
    }

    // Validate linkedVendorId if provided for vendor role
    if (invitationData.linkedVendorId && invitationData.role === 'vendor') {
      const primaryVendor = await this.userDAO.getUserById(invitationData.linkedVendorId);
      if (!primaryVendor) {
        throw new Error('Primary vendor not found');
      }

      // Check if the referenced user is actually a primary vendor (no linkedVendorId)
      const vendorCuid = primaryVendor.cuids.find((c) => c.cuid === clientInfo.cuid);
      if (!vendorCuid || !vendorCuid.roles.includes('vendor' as any)) {
        throw new Error('Referenced user is not a vendor for this client');
      }

      if (vendorCuid.linkedVendorId) {
        throw new Error('Cannot link to a vendor that is already linked to another vendor');
      }
    }

    // Check for existing pending invitation
    const existingInvitation = await this.invitationDAO.findPendingInvitation(
      invitationData.inviteeEmail,
      clientInfo.id
    );

    if (existingInvitation) {
      throw new Error('A pending invitation already exists for this email');
    }

    // check if user already has access
    const existingUser = await this.userDAO.getUserWithClientAccess(
      invitationData.inviteeEmail,
      clientInfo.cuid
    );

    if (existingUser) {
      throw new Error('User already has access to this client');
    }

    // Create invitation with draft status - NO EMAIL SENDING
    const invitation = await this.invitationDAO.createInvitation(
      invitationData,
      inviterUserId,
      clientInfo.id
    );

    return invitation;
  }

  processCsvBulkUserValidation = async (job: Job<CsvJobData>, done: DoneCallback) => {
    job.progress(10);
    const { csvFilePath, clientInfo, userId, bulkCreateOptions } = job.data;
    this.log.info(
      `Processing bulk user CSV validation job ${job.id} for client ${clientInfo.cuid}`
    );

    try {
      job.progress(30);
      const result = await this.invitationCsvProcessor.validateCsv(csvFilePath, {
        userId,
        cuid: clientInfo.cuid,
      });
      job.progress(100);

      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);

      done(null, {
        processId: job.id,
        validCount: result.validInvitations.length,
        errorCount: result.errors ? result.errors.length : 0,
        errors: result.errors,
        success: true,
        totalRows: result.totalRows,
        finishedAt: result.finishedAt,
        mode: 'bulk_create',
        options: bulkCreateOptions,
      });
      this.log.info(
        `Done processing bulk user CSV validation job ${job.id} for client ${clientInfo.cuid}`
      );
    } catch (error) {
      this.log.error(`Error processing bulk user CSV validation job ${job.id}:`, error);
      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);
      done(error, null);
    }
  };

  processCsvBulkUserImport = async (job: Job<CsvJobData>, done: DoneCallback) => {
    const { csvFilePath, clientInfo, userId, bulkCreateOptions } = job.data;

    job.progress(10);
    this.log.info(`Processing bulk user CSV import job ${job.id} for client ${clientInfo.cuid}`);

    try {
      const csvResult = await this.invitationCsvProcessor.validateCsv(csvFilePath, {
        userId,
        cuid: clientInfo.cuid,
      });
      job.progress(30);

      if (!csvResult.validInvitations.length) {
        this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);
        done(null, {
          success: false,
          processId: job.id,
          data: null,
          finishedAt: new Date(),
          errors: csvResult.errors,
          message: 'No valid users found in CSV',
          mode: 'bulk_create',
        });
        return;
      }

      const results = [];
      let processed = 0;

      for (const userData of csvResult.validInvitations) {
        try {
          const result = await this.createBulkUser(
            userId,
            clientInfo,
            userData,
            bulkCreateOptions || {}
          );
          results.push({
            email: userData.inviteeEmail,
            success: true,
            userId: result.userId,
            generatedPassword: result.generatedPassword,
            status: 'created',
          });
        } catch (error) {
          this.log.error(`Error creating user ${userData.inviteeEmail}:`, error);
          results.push({
            email: userData.inviteeEmail,
            success: false,
            error: error.message,
          });
        }

        processed++;
        const progress = 30 + Math.floor((processed / csvResult.validInvitations.length) * 60);
        job.progress(progress);

        // Small delay to avoid overwhelming the system
        if (processed < csvResult.validInvitations.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      job.progress(100);

      const successCount = results.filter((r) => r.success).length;
      const failedCount = results.filter((r) => !r.success).length;

      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);

      done(null, {
        success: true,
        processId: job.id,
        data: {
          totalProcessed: results.length,
          successCount,
          failedCount,
          results,
          mode: 'bulk_create',
          options: bulkCreateOptions,
        },
        finishedAt: new Date(),
        message: `Created ${successCount} users successfully, ${failedCount} failed`,
      });

      this.log.info(
        `Done processing bulk user CSV import job ${job.id} for client ${clientInfo.cuid}. Success: ${successCount}, Failed: ${failedCount}`
      );
    } catch (error) {
      this.log.error(`Error processing bulk user CSV import job ${job.id}:`, error);
      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);
      done(error, null);
    }
  };

  /**
   * Create a single user with default password (bypasses invitation flow)
   * Follows the same pattern as acceptInvitation but with generated password
   */
  private async createBulkUser(
    creatorUserId: string,
    clientInfo: IClientInfo,
    userData: IInvitationData,
    options: { sendNotifications?: boolean; passwordLength?: number }
  ) {
    if (!clientInfo.cuid || !clientInfo.id) {
      throw new Error('Client not found');
    }

    const generatedPassword = generateDefaultPassword(options.passwordLength || 12);
    const session = await this.userDAO.startSession();
    const result = await this.userDAO.withTransaction(session, async (session) => {
      // Check if user already exists
      const existingUser = await this.userDAO.getActiveUserByEmail(userData.inviteeEmail);

      let user;
      const linkedVendorId =
        userData.linkedVendorId && userData.role === 'vendor'
          ? userData.linkedVendorId.toString()
          : undefined;

      if (existingUser) {
        // User exists, add them to this client
        user = await this.userDAO.addUserToClient(
          existingUser._id.toString(),
          userData.role,
          {
            id: clientInfo.id!.toString(),
            cuid: clientInfo.cuid,
            clientDisplayName: clientInfo.clientDisplayName,
          },
          linkedVendorId,
          session
        );
      } else {
        // Create new user with bulk method
        user = await this.userDAO.createBulkUserWithDefaults(
          {
            cuid: clientInfo.cuid,
            clientDisplayName: clientInfo.clientDisplayName,
            id: clientInfo.id!,
          },
          {
            email: userData.inviteeEmail,
            firstName: userData.personalInfo.firstName,
            lastName: userData.personalInfo.lastName,
            phoneNumber: userData.personalInfo.phoneNumber,
            role: userData.role,
            defaultPassword: generatedPassword,
          },
          linkedVendorId,
          session
        );

        if (!user) {
          throw new Error('Error creating user account.');
        }

        // Create user profile with rich metadata from CSV (following acceptInvitation pattern)
        const profileData: any = {
          user: user._id,
          puid: user.uid,
          personalInfo: {
            firstName: userData.personalInfo.firstName,
            lastName: userData.personalInfo.lastName,
            displayName: `${userData.personalInfo.firstName} ${userData.personalInfo.lastName}`,
            phoneNumber: userData.personalInfo.phoneNumber || '',
            location: 'Unknown',
          },
          lang: 'en',
          timeZone: 'UTC',
          policies: {
            tos: {
              accepted: true, // Auto-accept for bulk created users
              acceptedOn: new Date(),
            },
            marketing: {
              accepted: false, // Conservative default - no marketing consent
              acceptedOn: null,
            },
          },
        };

        // Add vendor info if this is a vendor user
        if (userData.role === 'vendor') {
          if (linkedVendorId) {
            profileData.vendorInfo = {
              isLinkedAccount: true,
              companyName: null,
              businessType: null,
              taxId: null,
              registrationNumber: null,
              yearsInBusiness: 0,
              servicesOffered: {},
              contactPerson: {
                name: `${userData.personalInfo.firstName} ${userData.personalInfo.lastName}`,
                jobTitle: userData.metadata?.vendorInfo?.contactPerson?.jobTitle || 'Associate',
                email: userData.inviteeEmail,
                phone: userData.personalInfo.phoneNumber || '',
              },
            };
          } else if (userData.metadata?.vendorInfo) {
            profileData.vendorInfo = {
              ...userData.metadata.vendorInfo,
              isLinkedAccount: false,
            };
          }
        }

        // Add employee info for staff/admin/manager users ONLY (not vendors)
        if (
          ['manager', 'staff', 'admin'].includes(userData.role) &&
          userData.metadata?.employeeInfo
        ) {
          profileData.employeeInfo = userData.metadata.employeeInfo;
        }

        await this.profileDAO.createUserProfile(user._id, profileData, session);
      }

      return { user, linkedVendorId };
    });

    // Initialize role-specific info (outside transaction like acceptInvitation)
    if (result.user) {
      await this.profileService.initializeRoleInfo(
        result.user._id.toString(),
        clientInfo.cuid,
        userData.role,
        result.linkedVendorId
      );

      // Log vendor linking if applicable
      if (result.linkedVendorId && userData.role === 'vendor') {
        this.log.info(
          `Vendor link established from primary vendor ${result.linkedVendorId} to new user ${result.user._id}`
        );
      }
    }

    // Send welcome email with credentials if notifications are enabled
    if (options.sendNotifications) {
      const emailData = {
        to: userData.inviteeEmail,
        subject: t('email.userCreated.subject', {
          companyName: clientInfo.clientDisplayName || 'Company',
        }),
        emailType: MailType.USER_CREATED,
        data: {
          firstName: userData.personalInfo.firstName,
          lastName: userData.personalInfo.lastName,
          companyName: clientInfo.clientDisplayName || 'Company',
          email: userData.inviteeEmail,
          temporaryPassword: generatedPassword,
          loginUrl: `${envVariables.FRONTEND.URL}/login`,
          role: userData.role,
          // Include additional metadata for personalized emails
          customMessage: userData.metadata?.inviteMessage,
          expectedStartDate: userData.metadata?.expectedStartDate,
          department: userData.metadata?.employeeInfo?.department,
          jobTitle: userData.metadata?.employeeInfo?.jobTitle,
          vendorCompanyName: userData.metadata?.vendorInfo?.companyName,
        },
      };
      this.emailQueue.addToEmailQueue(JOB_NAME.USER_CREATED_JOB, emailData);
    }

    this.log.info(`Bulk user created: ${userData.inviteeEmail} for client ${clientInfo.cuid}`);

    return {
      userId: result.user?._id?.toString() || '',
      generatedPassword: generatedPassword,
      user: result.user,
    };
  }
}
