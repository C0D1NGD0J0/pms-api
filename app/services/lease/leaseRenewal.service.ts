import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { LeaseCache } from '@caching/index';
import { UserService } from '@services/index';
import { PropertyDAO } from '@dao/propertyDAO';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { EventTypes } from '@interfaces/events.interface';
import { IUserRole } from '@shared/constants/roles.constants';
import { IPropertyDocument, ICronJob } from '@interfaces/index';
import { InvalidRequestError, BadRequestError } from '@shared/customErrors';
import { convertUserRoleToEnum, LEASE_CONSTANTS, createLogger } from '@utils/index';
import { InvitationDAO, ProfileDAO, ClientDAO, LeaseDAO, UserDAO } from '@dao/index';
import { ILeaseDocument, ILeaseFormData, LeaseStatus } from '@interfaces/lease.interface';
import { EventEmitterService, NotificationService, InvitationService } from '@services/index';
import {
  IPromiseReturnedData,
  ISuccessReturnData,
  IRequestContext,
} from '@interfaces/utils.interface';
import {
  NotificationPriorityEnum,
  NotificationTypeEnum,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';

import { calculateRenewalMetadata } from './leaseHelpers';

interface IConstructor {
  notificationService: NotificationService;
  invitationService: InvitationService;
  emitterService: EventEmitterService;
  propertyUnitDAO: PropertyUnitDAO;
  invitationDAO: InvitationDAO;
  userService: UserService;
  propertyDAO: PropertyDAO;
  leaseCache: LeaseCache;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  leaseDAO: LeaseDAO;
  userDAO: UserDAO;
}

export class LeaseRenewalService {
  private readonly log: Logger;
  private readonly userDAO: UserDAO;
  private readonly leaseDAO: LeaseDAO;
  private readonly clientDAO: ClientDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly leaseCache: LeaseCache;
  private readonly propertyDAO: PropertyDAO;
  private readonly userService: UserService;
  private readonly invitationDAO: InvitationDAO;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly emitterService: EventEmitterService;
  private readonly invitationService: InvitationService;
  private readonly notificationService: NotificationService;

  constructor({
    notificationService,
    invitationService,
    emitterService,
    invitationDAO,
    propertyUnitDAO,
    propertyDAO,
    profileDAO,
    clientDAO,
    userService,
    leaseDAO,
    userDAO,
    leaseCache,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.leaseDAO = leaseDAO;
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.leaseCache = leaseCache;
    this.propertyDAO = propertyDAO;
    this.userService = userService;
    this.invitationDAO = invitationDAO;
    this.emitterService = emitterService;
    this.propertyUnitDAO = propertyUnitDAO;
    this.log = createLogger('LeaseRenewalService');
    this.invitationService = invitationService;
    this.notificationService = notificationService;
  }

  /**
   * Get renewal form data for a lease
   * Returns pre-populated form data for creating a lease renewal
   */
  async getRenewalFormData(cxt: IRequestContext, luid: string): Promise<ISuccessReturnData<any>> {
    try {
      const { cuid } = cxt.request.params;

      if (!cuid || !luid) {
        throw new BadRequestError({ message: t('property.errors.clientIdRequired') });
      }

      const lease = await this.leaseDAO.findFirst(
        { luid, cuid, deletedAt: null },
        { populate: ['propertyInfo', 'propertyUnitInfo', 'tenantInfo'] }
      );
      if (!lease) {
        throw new InvalidRequestError({ message: t('lease.not_found') });
      }

      // Only allow for active or draft_renewal leases
      if (!['draft_renewal', 'active'].includes(lease.status)) {
        throw new InvalidRequestError({
          message: `Cannot generate renewal form data for ${lease.status} lease. Only active or draft_renewal leases are eligible.`,
        });
      }

      // Validate lease has required data for renewal
      if (!lease.duration?.endDate) {
        throw new InvalidRequestError({
          message: 'Lease is missing required duration information for renewal.',
        });
      }

      // Calculate renewal metadata to get form data
      const renewalMetadata = calculateRenewalMetadata(lease, true);
      if (!renewalMetadata) {
        throw new InvalidRequestError({
          message:
            'Unable to calculate renewal form data. Please ensure the lease has valid dates.',
        });
      }

      return {
        success: true,
        message: 'Renewal form data retrieved successfully',
        data: renewalMetadata.renewalFormData,
      };
    } catch (error: any) {
      this.log.error('Error getting renewal form data:', error);
      throw error;
    }
  }

  /**
   * Create a renewal lease from an existing lease
   * Creates a new lease with draft_renewal status that requires admin approval
   */
  async createDraftLeaseRenewal(
    cuid: string,
    luid: string,
    renewalData: Partial<ILeaseFormData>,
    ctx: IRequestContext | null = null,
    validateLeaseDataFn?: (
      cuid: string,
      data: ILeaseFormData,
      property: IPropertyDocument
    ) => Promise<{ hasErrors: boolean; errors: any }>
  ): IPromiseReturnedData<ILeaseDocument> {
    // For system calls, use a placeholder ObjectId that represents "system"
    const systemId = new Types.ObjectId('000000000000000000000000');
    const userId = ctx?.currentuser.sub.toString() || systemId;
    const userName = ctx?.currentuser?.fullname || 'System';
    const userRole = ctx ? convertUserRoleToEnum(ctx.currentuser!.client.role) : null;

    const isSystemCall = !ctx;

    const existingLease = await this.leaseDAO.findFirst(
      { luid, cuid, deletedAt: null },
      {
        populate: ['tenantInfo', 'propertyInfo', 'propertyUnitInfo'],
      }
    );

    if (!existingLease) {
      throw new InvalidRequestError({
        message: t('lease.errors.notFound'),
      });
    }

    if (!['active'].includes(existingLease.status)) {
      throw new BadRequestError({
        message: 'Only active or recently expired leases can be renewed',
      });
    }

    const session = await this.leaseDAO.startSession();
    const renewalLease = await this.leaseDAO.withTransaction(session, async (session) => {
      const existingRenewal = await this.leaseDAO.findFirst({
        previousLeaseId: existingLease._id,
        cuid,
        deletedAt: null,
        status: { $in: ['draft_renewal', 'pending_signature', 'active', 'ready_for_signature'] },
      });

      if (existingRenewal) {
        if (isSystemCall) {
          // for system calls (cron jobs), just return existing
          return { data: existingRenewal, success: true };
        }
        throw new BadRequestError({
          message: 'A renewal already exists for this lease',
        });
      }

      const renewalTermMonths =
        renewalData.renewalOptions?.renewalTermMonths ||
        existingLease.renewalOptions?.renewalTermMonths ||
        12;
      const defaultStartDate = dayjs(existingLease.duration.endDate).add(1, 'day').toDate();
      const defaultEndDate = dayjs(defaultStartDate).add(renewalTermMonths, 'month').toDate();

      // Validate renewal-specific data if provided by user
      if (renewalData && Object.keys(renewalData).length > 0 && validateLeaseDataFn) {
        // Only validate user-provided changes, not the entire renewal
        // Check duration dates are valid
        if (renewalData.duration) {
          const { startDate, endDate } = renewalData.duration;
          if (startDate && endDate) {
            if (new Date(startDate) >= new Date(endDate)) {
              return {
                success: false,
                error: 'Renewal start date must be before end date',
                message: 'Invalid renewal duration',
                data: null,
              };
            }
            // Renewal should start after original lease ends
            if (new Date(startDate) <= existingLease.duration.endDate) {
              return {
                success: false,
                error: 'Renewal start date must be after original lease end date',
                message: 'Invalid renewal start date',
                data: null,
              };
            }
          }
        }

        // Validate fee amounts if provided
        if (renewalData.fees) {
          if (renewalData.fees.monthlyRent !== undefined && renewalData.fees.monthlyRent < 0) {
            return {
              success: false,
              error: 'Monthly rent cannot be negative',
              message: 'Invalid renewal fees',
              data: null,
            };
          }
          if (
            renewalData.fees.securityDeposit !== undefined &&
            renewalData.fees.securityDeposit < 0
          ) {
            return {
              success: false,
              error: 'Security deposit cannot be negative',
              message: 'Invalid renewal fees',
              data: null,
            };
          }
        }
      }

      const cleanLease = existingLease.toObject();
      delete cleanLease._id;
      delete cleanLease.luid;
      delete cleanLease.leaseNumber;
      delete cleanLease.createdAt;
      delete cleanLease.updatedAt;
      delete cleanLease.__v;
      delete cleanLease.status;
      delete cleanLease.tenantInfo;
      delete cleanLease.propertyInfo;
      delete cleanLease.propertyUnitInfo;

      const newLeaseData = {
        ...cleanLease,
        previousLeaseId: existingLease._id,
        status: LeaseStatus.DRAFT_RENEWAL,
        approvalStatus:
          isSystemCall && existingLease.renewalOptions?.requireApproval !== false
            ? 'pending'
            : 'approved',
        duration: renewalData.duration || {
          startDate: defaultStartDate,
          endDate: defaultEndDate,
          moveInDate: defaultStartDate,
        },

        fees: {
          ...existingLease.fees,
          ...renewalData.fees,
        },

        renewalOptions: renewalData.renewalOptions || existingLease.renewalOptions,
        utilitiesIncluded: renewalData.utilitiesIncluded || existingLease.utilitiesIncluded,
        petPolicy: renewalData.petPolicy || existingLease.petPolicy,
        coTenants: renewalData.coTenants || existingLease.coTenants,
        legalTerms: renewalData.legalTerms || existingLease.legalTerms,

        internalNotes: renewalData.internalNotes
          ? [
              {
                note: renewalData.internalNotes,
                author: userName,
                authorId: userId,
                timestamp: new Date(),
              },
            ]
          : [],

        signatures: [],
        eSignature: undefined,
        signedDate: undefined,
        signingMethod: 'pending', // Renewal will determine signing method later
        leaseDocuments: [], // Renewal needs to regenerate documents

        createdBy: userId,
        lastModifiedBy: [
          {
            action: 'created',
            userId,
            name: userName,
            date: new Date(),
          },
        ],
        approvalDetails: [
          {
            action: 'created',
            timestamp: new Date(),
            actor: isSystemCall ? systemId : userId,
            notes: isSystemCall ? 'Auto-renewal created by system' : 'Manual renewal created',
          },
        ],
        pendingChanges: null,
        cuid,
      };

      // For system-generated renewals, automatically approve if configured
      const autoApprove = !ctx && existingLease.renewalOptions?.autoRenew;
      if (autoApprove) {
        newLeaseData.approvalStatus = 'approved';
        newLeaseData.approvalDetails.push({
          action: 'approved',
          actor: systemId,
          timestamp: new Date(),
          notes: 'Auto-approved due to auto-renewal configuration',
        });
      }

      const result = await this.leaseDAO.insert(newLeaseData, session);
      return { data: result, success: !!result };
    });

    if (!renewalLease.data) {
      throw new Error('Failed to create renewal lease');
    }
    this.log.info(`Created renewal lease: ${renewalLease?.data?.luid} from lease: ${luid}`);

    this.emitterService.emit(EventTypes.LEASE_RENEWED, {
      originalLeaseId: existingLease.luid,
      renewalLeaseId: renewalLease?.data?.luid || '',
      status: 'draft_renewal',
      approvalStatus: renewalLease?.data?.approvalStatus || 'pending',
      startDate: renewalLease.data?.duration.startDate,
      endDate: renewalLease.data?.duration.endDate,
      monthlyRent: renewalLease.data?.fees.monthlyRent || 0,
      tenantId: existingLease.tenantId.toString(),
      propertyId: existingLease.property.id.toString(),
      propertyUnitId: existingLease.property.unitId?.toString(),
      cuid,
    });

    // Send in-app notification if manual renewal needs approval
    if (renewalLease.data.approvalStatus === 'pending') {
      try {
        if (isSystemCall) {
          // System renewal - notify the property manager/owner who created the original lease
          if (existingLease.createdBy) {
            await this.notificationService.createNotification(cuid, NotificationTypeEnum.LEASE, {
              type: NotificationTypeEnum.LEASE,
              cuid,
              recipient: existingLease.createdBy.toString(),
              recipientType: RecipientTypeEnum.INDIVIDUAL,
              priority: NotificationPriorityEnum.HIGH,
              title: 'Lease Renewal Pending Approval',
              message: `Auto-renewal created for lease ${existingLease.leaseNumber} and requires your approval`,
              metadata: {
                leaseId: renewalLease.data.luid,
                originalLeaseId: existingLease.luid,
                renewalStartDate: renewalLease.data.duration.startDate,
                renewalEndDate: renewalLease.data.duration.endDate,
                monthlyRent: renewalLease.data.fees.monthlyRent,
                isAutoRenewal: true,
                actionRequired: true,
                actionType: 'approve_renewal',
              },
            });
          }
        } else if (userRole === IUserRole.STAFF) {
          // Staff created renewal - find and notify their supervisor
          const supervisorId = await this.userService.getUserSupervisor(userId.toString(), cuid);

          if (supervisorId) {
            // Notify supervisor
            await this.notificationService.createNotification(cuid, NotificationTypeEnum.LEASE, {
              type: NotificationTypeEnum.LEASE,
              cuid,
              recipient: supervisorId,
              recipientType: RecipientTypeEnum.INDIVIDUAL,
              priority: NotificationPriorityEnum.HIGH,
              title: 'Lease Renewal Pending Approval',
              message: `${userName} created a renewal for lease ${existingLease.leaseNumber} that requires your approval`,
              metadata: {
                leaseId: renewalLease.data.luid,
                originalLeaseId: existingLease.luid,
                renewalStartDate: renewalLease.data.duration.startDate,
                renewalEndDate: renewalLease.data.duration.endDate,
                monthlyRent: renewalLease.data.fees.monthlyRent,
                createdBy: userId,
                createdByName: userName,
                actionRequired: true,
                actionType: 'approve_renewal',
              },
            });

            // Confirmation to staff
            await this.notificationService.createNotification(cuid, NotificationTypeEnum.LEASE, {
              type: NotificationTypeEnum.LEASE,
              cuid,
              recipient: userId,
              recipientType: RecipientTypeEnum.INDIVIDUAL,
              priority: NotificationPriorityEnum.LOW,
              title: 'Lease Renewal Submitted',
              message: `Your renewal for lease ${existingLease.leaseNumber} has been submitted for approval`,
              metadata: {
                leaseId: renewalLease.data.luid,
                originalLeaseId: existingLease.luid,
                submittedTo: supervisorId,
              },
            });
          } else {
            // No supervisor found - log warning
            this.log.warn('Staff member has no supervisor assigned for renewal approval', {
              userId,
              userName,
              leaseId: renewalLease.data.luid,
              cuid,
            });
          }
        }
        // Manager/Admin renewals don't need approval notifications (they can approve immediately)
      } catch (error) {
        this.log.error('Failed to send renewal notifications', { error, leaseId: luid });
        // Don't fail the renewal if notification fails
      }
    }

    return { data: renewalLease.data, success: renewalLease.success };
  }

  /**
   * CRON JOB: Process automatic lease renewals
   * Creates draft renewal leases for eligible active leases
   * Runs daily at midnight UTC
   */
  async processAutoRenewals(): Promise<void> {
    this.log.info('Starting automatic lease renewal processing');

    try {
      const today = new Date();

      // Find leases with auto-renewal enabled
      const eligibleLeases = await this.leaseDAO.list(
        {
          status: LeaseStatus.ACTIVE,
          'renewalOptions.autoRenew': true,
          'renewalOptions.daysBeforeExpiryToGenerateRenewal': { $exists: true },
          deletedAt: null,
        },
        {
          populate: ['tenantInfo', 'propertyInfo', 'propertyUnitInfo'],
        }
      );

      this.log.info(`Checking ${eligibleLeases.items.length} leases with auto-renewal enabled`);

      let createdCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const lease of eligibleLeases.items) {
        try {
          // Calculate if it's time to create renewal
          const daysBeforeExpiry =
            lease.renewalOptions?.daysBeforeExpiryToGenerateRenewal ||
            LEASE_CONSTANTS.DEFAULT_RENEWAL_DAYS_BEFORE_EXPIRY;
          const daysUntilExpiry = Math.ceil(
            (lease.duration.endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
          );

          // Check if we're in the creation window (within 1 day tolerance)
          if (daysUntilExpiry < daysBeforeExpiry - 1 || daysUntilExpiry > daysBeforeExpiry + 1) {
            skippedCount++;
            continue;
          }

          // Check if renewal already exists
          const existingRenewal = await this.leaseDAO.findFirst({
            previousLeaseId: lease._id,
            deletedAt: null,
          });

          if (existingRenewal) {
            this.log.info(
              `Skipping ${lease.luid} - renewal exists with status ${existingRenewal.status}`
            );
            skippedCount++;
            continue;
          }

          // Determine if auto-approve or needs admin review
          const autoApprove = lease.renewalOptions?.requireApproval === false;

          // Warn if conflicting settings detected
          if (
            lease.renewalOptions?.autoRenew &&
            lease.signingMethod === 'manual' &&
            lease.renewalOptions?.enableAutoSendForSignature
          ) {
            this.log.warn(
              `Lease ${lease.luid} has conflicting settings: autoRenew + manual signing + enableAutoSend. ` +
                "Auto-send will not work. Consider setting signingMethod to 'electronic'."
            );
          }

          this.log.info(
            `Creating ${autoApprove ? 'auto-approved' : 'draft'} renewal for ${lease.luid} (${daysUntilExpiry} days until expiry)`
          );

          // Create renewal using existing createDraftLeaseRenewal method
          const renewalResult = await this.createDraftLeaseRenewal(
            lease.cuid,
            lease.luid,
            {},
            null
          );

          if (renewalResult.success) {
            // If auto-approve, validate and update status to ready_for_signature
            if (autoApprove) {
              // Check if lease documents exist before setting ready_for_signature
              if (
                !renewalResult.data.leaseDocuments ||
                renewalResult.data.leaseDocuments.length === 0
              ) {
                this.log.warn(
                  `Renewal ${renewalResult.data.luid} requires approval but has no lease documents yet. ` +
                    'Will remain in draft_renewal until PDF is generated.'
                );
              } else {
                await this.leaseDAO.updateById(renewalResult.data._id.toString(), {
                  status: 'ready_for_signature',
                  approvalStatus: 'approved',
                  $push: {
                    approvalDetails: {
                      action: 'auto_approved',
                      actor: new Types.ObjectId('000000000000000000000000'),
                      timestamp: new Date(),
                      notes: 'Auto-approved via renewalOptions.requireApproval=false',
                    },
                  },
                });

                this.log.info(
                  `Auto-approved renewal ${renewalResult.data.luid} - ready for signature`
                );
              }
            }

            createdCount++;

            // Send lifecycle notification (only to admins/managers, not tenant)
            await this.notificationService.notifyLeaseLifecycleEvent({
              eventType: 'renewal_created',
              lease: {
                luid: renewalResult.data.luid,
                leaseNumber: renewalResult.data.leaseNumber,
                cuid: lease.cuid,
                tenantId: lease.tenantId.toString(),
                propertyAddress: lease.property?.address || 'Property',
                endDate: renewalResult.data.duration.endDate,
                startDate: renewalResult.data.duration.startDate,
              },
              recipients: {
                propertyManager: lease.propertyInfo?.managedBy?.toString(),
                createdBy: lease.createdBy?.toString(),
              },
              metadata: {
                autoApproved: autoApprove,
                originalLeaseId: lease.luid,
                daysUntilExpiry,
              },
            });
          }
        } catch (error: any) {
          errorCount++;
          this.log.error(`Failed to create renewal for ${lease.luid}`, {
            error: error.message,
            stack: error.stack,
          });

          // Notify admin of failure
          const recipientIds = [];
          if (lease.propertyInfo?.managedBy)
            recipientIds.push(lease.propertyInfo.managedBy.toString());
          if (lease.createdBy) recipientIds.push(lease.createdBy.toString());

          if (recipientIds.length > 0) {
            await this.notificationService.notifySystemError({
              cuid: lease.cuid,
              recipientIds,
              errorType: 'auto_renewal_failed',
              resourceType: 'lease',
              resourceIdentifier: lease.leaseNumber,
              errorMessage: error.message,
              metadata: {
                leaseId: lease.luid,
                daysUntilExpiry: Math.ceil(
                  (lease.duration.endDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
                ),
              },
            });
          }
        }
      }

      this.log.info('Auto-renewal draft creation completed', {
        total: eligibleLeases.items.length,
        created: createdCount,
        skipped: skippedCount,
        errors: errorCount,
      });
    } catch (error: any) {
      this.log.error('Error in processAutoRenewals cron job', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * CRON JOB: Auto-send renewals that are ready_for_signature
   * Sends renewals for e-signature based on timing configuration
   * Runs daily at 9 AM UTC
   */
  async autoSendRenewalsForSignature(
    sendLeaseForSignatureFn: (ctx: IRequestContext) => Promise<any>
  ): Promise<void> {
    this.log.info('Starting auto-send renewals for signature');

    try {
      const today = new Date();

      // Find renewals in ready_for_signature status that are approved
      const readyRenewals = await this.leaseDAO.list(
        {
          status: 'ready_for_signature',
          approvalStatus: 'approved',
          previousLeaseId: { $exists: true },
          deletedAt: null,
        },
        {
          populate: ['previousLeaseId', 'tenantInfo', 'propertyInfo'],
        }
      );

      this.log.info(`Found ${readyRenewals.items.length} renewals in ready_for_signature status`);

      let sentCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const renewal of readyRenewals.items) {
        try {
          const originalLease = renewal.previousLeaseId as any;

          if (!originalLease) {
            this.log.error(`Original lease not found for renewal ${renewal.luid}`);
            errorCount++;
            continue;
          }

          // Validation 1: Check if auto-send is enabled
          const autoSendEnabled =
            renewal.renewalOptions?.enableAutoSendForSignature === true ||
            originalLease.renewalOptions?.enableAutoSendForSignature === true;

          if (!autoSendEnabled) {
            skippedCount++;
            continue;
          }

          // Validation 2: Check signing method is electronic
          if (renewal.signingMethod !== 'electronic') {
            // Manual signing is intentional - just skip without marking as failure
            this.log.info(
              `Skipping ${renewal.luid} - manual signing method (auto-send only works for electronic signatures)`
            );
            skippedCount++;
            continue;
          }

          // Validation 3: Check e-signature provider is configured
          if (!renewal.eSignature?.provider) {
            // This IS an error - electronic signing requires a provider
            this.log.warn(
              `Skipping ${renewal.luid} - no e-signature provider configured (signingMethod is electronic but provider is missing)`
            );
            await this.leaseDAO.updateById(renewal._id.toString(), {
              'autoSendInfo.failureReason': 'no_provider',
              'autoSendInfo.failedAt': new Date(),
            });
            errorCount++;
            continue;
          }

          // Calculate when to send
          const daysBeforeSend =
            renewal.renewalOptions?.daysBeforeExpiryToAutoSendSignature ||
            originalLease.renewalOptions?.daysBeforeExpiryToAutoSendSignature ||
            LEASE_CONSTANTS.DEFAULT_SEND_FOR_SIGNATURE_DAYS;

          const targetSendDate = dayjs(originalLease.duration.endDate)
            .subtract(daysBeforeSend, 'days')
            .toDate();
          const daysUntilExpiry = Math.ceil(
            (originalLease.duration.endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
          );

          // Validation 4: Check if original lease expired too long ago (grace period)
          if (daysUntilExpiry < -7) {
            // Original lease expired beyond grace period - likely a data issue or missed timing
            // Mark as failure so admin can investigate why renewal wasn't sent earlier
            this.log.warn(
              `Skipping ${renewal.luid} - original lease expired ${Math.abs(daysUntilExpiry)} days ago (beyond grace period). ` +
                'Renewal may need manual review.'
            );
            await this.leaseDAO.updateById(renewal._id.toString(), {
              'autoSendInfo.failureReason': 'original_lease_expired',
              'autoSendInfo.failedAt': new Date(),
            });
            errorCount++; // Count as error since this indicates missed timing
            continue;
          }

          // Check if it's time to send
          if (today >= targetSendDate) {
            this.log.info(
              `Auto-sending renewal ${renewal.luid} for signature (${daysUntilExpiry} days until original lease expires)`
            );

            // Create mock context for system call
            const mockContext = {
              request: {
                params: {
                  cuid: renewal.cuid,
                  luid: renewal.luid,
                },
              },
              currentuser: {
                uid: 'system',
                sub: 'system',
                client: {
                  cuid: renewal.cuid,
                  role: 'admin',
                },
              },
            } as any;

            // Call sendLeaseForSignature
            await sendLeaseForSignatureFn(mockContext);

            sentCount++;
            this.log.info(`Successfully sent renewal ${renewal.luid} for signature`);
          } else {
            this.log.info(
              `Renewal ${renewal.luid} scheduled to send on ${targetSendDate.toISOString()} (${daysBeforeSend} days before expiry)`
            );
            skippedCount++;
          }
        } catch (error: any) {
          errorCount++;
          this.log.error(`Failed to auto-send renewal ${renewal.luid}`, {
            error: error.message,
            stack: error.stack,
          });

          // Notify admin of failure
          const originalLease = renewal.previousLeaseId as any;
          const recipientIds = [];
          if (renewal.propertyInfo?.managedBy)
            recipientIds.push(renewal.propertyInfo.managedBy.toString());
          if (originalLease?.createdBy) recipientIds.push(originalLease.createdBy.toString());

          if (recipientIds.length > 0) {
            await this.notificationService.notifySystemError({
              cuid: renewal.cuid,
              recipientIds,
              errorType: 'auto_send_failed',
              resourceType: 'lease',
              resourceIdentifier: renewal.leaseNumber,
              errorMessage: error.message,
              metadata: {
                renewalId: renewal.luid,
              },
            });
          }
        }
      }

      this.log.info('Auto-send renewals completed', {
        total: readyRenewals.items.length,
        sent: sentCount,
        skipped: skippedCount,
        errors: errorCount,
      });
    } catch (error: any) {
      this.log.error('Error in autoSendRenewalsForSignature cron job', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Approve a draft renewal for signature
   * Called by admin/property manager to approve a draft renewal
   */
  async approveRenewalForSignature(
    cuid: string,
    luid: string,
    renewalData: Partial<ILeaseFormData>,
    ctx: IRequestContext
  ): IPromiseReturnedData<ILeaseDocument | null> {
    this.log.info(`Approving renewal ${luid} for signature`);

    try {
      // Find the renewal lease
      const renewal = await this.leaseDAO.findFirst({
        luid,
        cuid,
        deletedAt: null,
      });

      if (!renewal) {
        return {
          data: null,
          success: false,
          error: 'Renewal lease not found',
          message: 'Renewal lease not found',
        };
      }

      // Validate status
      if (renewal.status !== 'draft_renewal') {
        return {
          data: null,
          success: false,
          error: `Cannot approve renewal with status ${renewal.status}. Must be draft_renewal.`,
          message: `Cannot approve renewal with status ${renewal.status}`,
        };
      }

      // If renewalData is provided, validate and apply updates before approving
      const updateData: any = {
        status: 'ready_for_signature',
        approvalStatus: 'approved',
        $push: {
          approvalDetails: {
            action: 'approved',
            timestamp: new Date(),
            actor: ctx?.currentuser.sub,
            notes:
              renewalData && Object.keys(renewalData).length > 0
                ? 'Approved for signature with modifications by admin/property manager'
                : 'Approved for signature by admin/property manager',
          },
          lastModifiedBy: {
            action: 'approved_for_signature',
            userId: ctx?.currentuser.sub || 'system',
            name: ctx?.currentuser.fullname || 'Admin',
            date: new Date(),
          },
        },
      };

      // Apply renewalData updates if provided
      if (renewalData && Object.keys(renewalData).length > 0) {
        // Validate renewal updates before applying
        // Check duration dates are valid
        if (renewalData.duration) {
          const { startDate, endDate } = renewalData.duration;
          if (startDate && endDate) {
            if (new Date(startDate) >= new Date(endDate)) {
              return {
                success: false,
                error: 'Renewal start date must be before end date',
                message: 'Invalid renewal duration',
                data: null,
              };
            }
            // Renewal should start after original lease ends
            const originalLease = await this.leaseDAO.findFirst({ _id: renewal.previousLeaseId });
            if (originalLease && new Date(startDate) <= originalLease.duration.endDate) {
              return {
                success: false,
                error: 'Renewal start date must be after original lease end date',
                message: 'Invalid renewal start date',
                data: null,
              };
            }
          }
        }

        // Validate fee amounts if provided
        if (renewalData.fees) {
          if (renewalData.fees.monthlyRent !== undefined && renewalData.fees.monthlyRent < 0) {
            return {
              success: false,
              error: 'Monthly rent cannot be negative',
              message: 'Invalid renewal fees',
              data: null,
            };
          }
          if (
            renewalData.fees.securityDeposit !== undefined &&
            renewalData.fees.securityDeposit < 0
          ) {
            return {
              success: false,
              error: 'Security deposit cannot be negative',
              message: 'Invalid renewal fees',
              data: null,
            };
          }
        }

        // Extract fields we DON'T want to update during approval
        const { property, tenantInfo, leaseNumber, ...allowedUpdates } = renewalData;

        // Merge all allowed updates into updateData at once
        Object.assign(updateData, allowedUpdates);

        this.log.info(`Applying renewal data updates to ${luid}`, {
          updatedFields: Object.keys(allowedUpdates),
        });
      }

      // Update status to ready_for_signature (with optional data updates)
      const updated = await this.leaseDAO.updateById(renewal._id.toString(), updateData);

      if (!updated) {
        return {
          data: null,
          success: false,
          error: 'Failed to update renewal status',
          message: 'Failed to update renewal status',
        };
      }

      // Get original lease for context
      if (!renewal.previousLeaseId) {
        throw new Error('Previous lease ID is missing on renewal');
      }

      const originalLease = await this.leaseDAO.findById(renewal.previousLeaseId?.toString());

      // Notify admins/managers that renewal has been approved (not tenant yet)
      await this.notificationService.notifyLeaseLifecycleEvent({
        eventType: 'renewal_approved',
        lease: {
          luid: renewal.luid,
          leaseNumber: renewal.leaseNumber,
          cuid: renewal.cuid,
          tenantId: renewal.tenantId.toString(),
          propertyAddress: renewal.property?.address || 'Property',
          endDate: renewal.duration.endDate,
          startDate: renewal.duration.startDate,
        },
        recipients: {
          propertyManager: renewal.propertyInfo?.managedBy?.toString(),
          createdBy: originalLease?.createdBy?.toString(),
        },
        metadata: {
          approvedBy: ctx?.currentuser.fullname || 'Admin',
          approvedAt: new Date().toISOString(),
          originalLeaseId: originalLease?.luid,
        },
      });

      this.log.info(`Renewal ${luid} approved for signature`);

      return {
        success: true,
        data: updated,
        message: 'Renewal approved for signature',
      };
    } catch (error: any) {
      this.log.error(`Error approving renewal ${luid}`, error);
      return {
        data: null,
        success: false,
        error: error.message || 'Failed to approve renewal',
        message: 'Failed to approve renewal for signature',
      };
    }
  }

  /**
   * Renew a lease
   * Alias for createDraftLeaseRenewal for backward compatibility
   */
  async renewLease(
    cuid: string,
    luid: string,
    renewalData: Partial<ILeaseFormData>,
    ctx: IRequestContext,
    validateLeaseDataFn?: (
      cuid: string,
      data: ILeaseFormData,
      property: IPropertyDocument
    ) => Promise<{ hasErrors: boolean; errors: any }>
  ): IPromiseReturnedData<ILeaseDocument> {
    return await this.createDraftLeaseRenewal(cuid, luid, renewalData, ctx, validateLeaseDataFn);
  }

  /**
   * Define cron jobs for lease renewal service
   */
  getCronJobs(sendLeaseForSignatureFn: (ctx: IRequestContext) => Promise<any>): ICronJob[] {
    return [
      {
        name: 'process-auto-renewals',
        schedule: '0 0 * * *', // Daily at midnight UTC
        handler: this.processAutoRenewals.bind(this),
        enabled: true,
        service: 'LeaseRenewalService',
        description:
          'Create draft renewal leases 30 days before expiry (or auto-approve if configured)',
        timeout: 600000,
      },
      {
        name: 'auto-send-renewals-for-signature',
        schedule: '0 9 * * *', // Daily at 9 AM UTC
        handler: () => this.autoSendRenewalsForSignature(sendLeaseForSignatureFn),
        enabled: true,
        service: 'LeaseRenewalService',
        description: 'Auto-send approved renewals for e-signature based on configured timing',
        timeout: 600000,
      },
    ];
  }
}
