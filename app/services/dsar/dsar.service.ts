import Logger from 'bunyan';
import { Types } from 'mongoose';
import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import { ClientDAO } from '@dao/clientDAO';
import { ProfileDAO } from '@dao/profileDAO';
import { PropertyDAO } from '@dao/propertyDAO';
import { QueueFactory } from '@services/queue';
import { EventTypes } from '@interfaces/index';
import { UserCache } from '@caching/user.cache';
import { AuthCache } from '@caching/auth.cache';
import { S3Service } from '@services/fileUpload';
import { EmailQueue, UserQueue } from '@queues/index';
import { ICronJob } from '@interfaces/cron.interface';
import { createLogger, JOB_NAME } from '@utils/index';
import { MailType } from '@interfaces/utils.interface';
import { LeaseStatus } from '@interfaces/lease.interface';
import { IUserRole } from '@shared/constants/roles.constants';
import { EventEmitterService, VendorService, UserService } from '@services/index';

export interface DSARExport {
  account: {
    email: string;
    uid: string;
    isActive: boolean;
    createdAt: Date;
    clientMemberships: Array<{ cuid: string; roles: string[]; clientDisplayName: string }>;
  };
  employeeInfo: Record<string, any> | null;
  gdprSettings: Record<string, any> | null;
  tenantInfo: Record<string, any> | null;
  vendorInfo: Record<string, any> | null;
  personalInfo: Record<string, any>;
  exportedAt: string;
  userId: string;
  leases: any[];
}

export interface DSARPreflightResult {
  blockers: Array<{ type: string; message: string; count?: number }>;
  eligible: boolean;
  userEmail: string;
}

interface IConstructor {
  emitterService: EventEmitterService;
  vendorService: VendorService;
  queueFactory: QueueFactory;
  propertyDAO: PropertyDAO;
  userService: UserService;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  userCache: UserCache;
  authCache: AuthCache;
  s3Service: S3Service;
  leaseDAO: LeaseDAO;
  userDAO: UserDAO;
}

export class DSARService {
  private readonly log: Logger;
  private readonly propertyDAO: PropertyDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly clientDAO: ClientDAO;
  private readonly userDAO: UserDAO;
  private readonly leaseDAO: LeaseDAO;
  private readonly userCache: UserCache;
  private readonly authCache: AuthCache;
  private readonly s3Service: S3Service;
  private readonly userService: UserService;
  private readonly emitterService: EventEmitterService;
  private readonly vendorService: VendorService;
  private readonly queueFactory: QueueFactory;

  constructor({
    propertyDAO,
    profileDAO,
    clientDAO,
    userDAO,
    leaseDAO,
    userCache,
    authCache,
    s3Service,
    userService,
    emitterService,
    vendorService,
    queueFactory,
  }: IConstructor) {
    this.log = createLogger('DSARService');
    this.propertyDAO = propertyDAO;
    this.profileDAO = profileDAO;
    this.clientDAO = clientDAO;
    this.userDAO = userDAO;
    this.leaseDAO = leaseDAO;
    this.userCache = userCache;
    this.authCache = authCache;
    this.s3Service = s3Service;
    this.userService = userService;
    this.emitterService = emitterService;
    this.vendorService = vendorService;
    this.queueFactory = queueFactory;
  }

  getCronJobs(): ICronJob[] {
    return [
      {
        name: 'dsar:enforce-data-retention',
        schedule: '30 4 * * *', // 4:30 AM UTC — overnight batch
        handler: this.enforceDataRetention.bind(this),
        service: 'DSARService',
        enabled: true,
        description: 'Auto-anonymise profiles whose data retention period has expired',
        timeout: 300_000, // 5 minutes — may process multiple profiles
      },
    ];
  }

  /**
   * Finds profiles with expired retention dates and anonymises them.
   * Only processes disconnected/inactive users (no active leases).
   * Skips users who are already anonymised (email ends with @anonymised.invalid).
   */
  private async enforceDataRetention(): Promise<void> {
    const now = new Date();

    const expiredProfiles = await this.profileDAO.list(
      {
        'settings.gdprSettings.retentionExpiryDate': { $lte: now },
        deletedAt: null,
      },
      { limit: 50 }
    );

    const profiles = expiredProfiles?.items ?? [];
    if (profiles.length === 0) {
      this.log.info('Data retention enforcement: no expired profiles found');
      return;
    }

    this.log.info(`Data retention enforcement: found ${profiles.length} expired profile(s)`);

    let anonymised = 0;
    let skipped = 0;

    for (const profile of profiles) {
      try {
        const userId = (profile as any).user?.toString();
        if (!userId) {
          skipped++;
          continue;
        }

        const user = await this.userDAO.getUserById(userId);
        if (!user) {
          skipped++;
          continue;
        }

        // Skip already-anonymised users
        if (user.email?.endsWith('@anonymised.invalid')) {
          skipped++;
          continue;
        }

        // Use the first connected cuid for context
        const activeCuid =
          user.cuids?.find((c: any) => c.isConnected)?.cuid ?? user.cuids?.[0]?.cuid;
        if (!activeCuid) {
          skipped++;
          continue;
        }

        await this.anonymiseUser(user.uid, activeCuid, 'system:retention-enforcement');
        anonymised++;
        this.log.info(`Retention enforcement: anonymised uid=${user.uid}`);
      } catch (error: any) {
        // Active lease guards will throw — that's expected, just skip
        skipped++;
        this.log.info(`Retention enforcement: skipped profile (${error.message})`);
      }
    }

    this.log.info(
      `Data retention enforcement complete: ${anonymised} anonymised, ${skipped} skipped`
    );
  }

  /**
   * Preflight check for anonymisation — runs the same guards as anonymiseUser
   * but returns blockers instead of throwing. Used by the frontend to show
   * warnings before the user confirms deletion.
   */
  async preflightAnonymise(uid: string, cuid: string): Promise<DSARPreflightResult> {
    this.log.info(`DSAR preflight check for uid=${uid}, cuid=${cuid}`);

    const user = await this.userDAO.getUserByUId(uid);
    if (!user) throw new Error(`User ${uid} not found`);

    const connection = user.cuids?.find((c: any) => c.cuid === cuid);
    if (!connection) {
      throw new Error(`User ${uid} is not associated with client ${cuid}`);
    }

    const blockers: DSARPreflightResult['blockers'] = [];
    const userId = user._id.toString();
    const PM_ROLES = ['super-admin', 'admin', 'manager'];

    // Check: account owner
    const client = await this.clientDAO.findFirst({ cuid });
    if (client && client.accountAdmin?.toString() === userId) {
      blockers.push({
        type: 'account_owner',
        message: 'Account owners cannot delete their own account. Transfer ownership first.',
      });
    }

    // Check all connected clients for lease/property blockers
    for (const conn of user.cuids || []) {
      if (!conn.isConnected) continue;

      const roles: string[] = conn.roles || [];
      const connCuid = conn.cuid;
      const clientLabel = conn.clientDisplayName || connCuid;

      // Check: tenant with active lease
      if (roles.includes('tenant')) {
        const activeLease = await this.leaseDAO.getActiveLeaseByTenant(connCuid, userId);
        if (activeLease) {
          blockers.push({
            type: 'active_leases',
            message: `You have an active lease on ${clientLabel}. Terminate or wait for it to expire first.`,
            count: 1,
          });
        }
      }

      // Check: PM managing properties with active leases
      if (roles.some((r) => PM_ROLES.includes(r))) {
        const managed = await this.propertyDAO.getPropertiesByClientId(
          connCuid,
          { managedBy: userId, deletedAt: null },
          { limit: 1000 }
        );

        if (managed.items.length > 0) {
          const propIds = managed.items.map((p: any) => p._id);
          const activeLeases = await this.leaseDAO.list(
            {
              cuid: connCuid,
              'property.id': { $in: propIds },
              status: { $in: [LeaseStatus.ACTIVE, LeaseStatus.PENDING_SIGNATURE] },
              deletedAt: null,
            },
            {},
            true
          );

          if (activeLeases.items.length > 0) {
            blockers.push({
              type: 'managed_active_leases',
              message: `You manage properties with ${activeLeases.items.length} active lease(s) on ${clientLabel}. Reassign properties or terminate leases first.`,
              count: activeLeases.items.length,
            });
          }
        }
      }
    }

    return {
      eligible: blockers.length === 0,
      blockers,
      userEmail: user.email,
    };
  }

  async exportUserData(uid: string, cuid: string): Promise<DSARExport> {
    this.log.info(`DSAR export requested for uid=${uid}, cuid=${cuid}`);

    const user = await this.userDAO.getUserByUId(uid);
    if (!user) throw new Error(`User ${uid} not found`);

    // Verify user belongs to the requesting client
    const connection = user.cuids?.find((c: any) => c.cuid === cuid);
    if (!connection) {
      throw new Error(`User ${uid} is not associated with client ${cuid}`);
    }

    const userId = user._id.toString();
    const [profile] = await Promise.all([this.profileDAO.getProfileByUserId(userId)]);

    const { items: leases } = await this.leaseDAO.list({
      cuid,
      tenantId: user._id,
      deletedAt: null,
    });

    const exported: DSARExport = {
      exportedAt: new Date().toISOString(),
      userId: uid,
      account: {
        email: user.email,
        uid: user.uid,
        isActive: user.isActive,
        createdAt: user.createdAt,
        clientMemberships: (user.cuids ?? [])
          .filter((c: any) => c.cuid === cuid)
          .map((c: any) => ({
            cuid: c.cuid,
            roles: c.roles,
            clientDisplayName: c.clientDisplayName,
          })),
      },
      personalInfo: profile?.personalInfo ? this.sanitisePersonalInfo(profile.personalInfo) : {},
      tenantInfo: profile?.tenantInfo ?? null,
      employeeInfo: profile?.employeeInfo ? this.sanitiseEmployeeInfo(profile.employeeInfo) : null,
      vendorInfo: profile?.vendorInfo ?? null,
      leases: (leases ?? []).map((l: any) => this.sanitiseLease(l)),
      gdprSettings: profile?.settings?.gdprSettings ?? null,
    };

    this.log.info(`DSAR export completed for uid=${uid}, cuid=${cuid}`);
    return exported;
  }

  /**
   * Full account deletion: cascade offboarding + PII anonymisation.
   * 1) Safety guards (account owner, active leases)
   * 2) Cascade: reassign properties, remove from staff, vendor cleanup, disconnect
   * 3) PII scrub: anonymise personal data, delete avatar, replace email
   * 4) Session invalidation
   */
  async anonymiseUser(uid: string, cuid: string, requestedBy: string): Promise<void> {
    this.log.info(`DSAR anonymisation requested for uid=${uid}, cuid=${cuid}, by=${requestedBy}`);

    const user = await this.userDAO.getUserByUId(uid);
    if (!user) throw new Error(`User ${uid} not found`);

    // Verify user belongs to the requesting client
    const connection = user.cuids?.find((c: any) => c.cuid === cuid);
    if (!connection) {
      throw new Error(`User ${uid} is not associated with client ${cuid}`);
    }

    // Guard: cannot anonymise the account owner — this would make the client unrecoverable
    const client = await this.clientDAO.findFirst({ cuid });
    if (client && client.accountAdmin?.toString() === user._id.toString()) {
      throw new Error('Cannot anonymise the account owner. Transfer account ownership first.');
    }

    const userId = user._id.toString();
    const PM_ROLES = ['super-admin', 'admin', 'manager'];

    for (const conn of user.cuids || []) {
      if (!conn.isConnected) continue;

      const roles: string[] = conn.roles || [];
      const connCuid = conn.cuid;
      const clientLabel = conn.clientDisplayName || connCuid;

      // Guard: tenant with active lease
      if (roles.includes('tenant')) {
        const activeLease = await this.leaseDAO.getActiveLeaseByTenant(
          connCuid,
          user._id.toString()
        );
        if (activeLease) {
          throw new Error(
            `Cannot anonymise: user has an active lease (${clientLabel}). Terminate lease first.`
          );
        }
      }

      // Guard: PM/admin managing properties with active leases
      if (roles.some((r) => PM_ROLES.includes(r))) {
        const managed = await this.propertyDAO.getPropertiesByClientId(
          connCuid,
          { managedBy: userId, deletedAt: null },
          { limit: 1000 }
        );

        if (managed.items.length > 0) {
          const propIds = managed.items.map((p: any) => p._id);
          const activeLeases = await this.leaseDAO.list(
            {
              cuid: connCuid,
              'property.id': { $in: propIds },
              status: { $in: [LeaseStatus.ACTIVE, LeaseStatus.PENDING_SIGNATURE] },
              deletedAt: null,
            },
            {},
            true
          );

          if (activeLeases.items.length > 0) {
            throw new Error(
              `Cannot anonymise: user manages properties with ${activeLeases.items.length} active lease(s) (${clientLabel}). Reassign or terminate first.`
            );
          }
        }
      }
    }

    // ── Cascade: offboarding logic (mirrors archiveUser) ──────────────

    const clientConnection = user.cuids?.find((c: any) => c.cuid === cuid);
    const roles: string[] = clientConnection?.roles || [];

    // Reassign managed properties to supervisor
    const managedProperties = await this.propertyDAO.getPropertiesByClientId(
      cuid,
      { managedBy: userId, deletedAt: null },
      { limit: 1000 }
    );

    if (managedProperties.items.length > 0) {
      const supervisorId = await this.userService.getUserSupervisor(userId, cuid);

      if (supervisorId) {
        for (const property of managedProperties.items) {
          await this.propertyDAO.updateById(property._id.toString(), {
            managedBy: new Types.ObjectId(supervisorId),
          });
        }
        this.log.info('Properties reassigned to supervisor', {
          uid,
          supervisorId,
          count: managedProperties.items.length,
        });
      } else {
        this.log.warn('No supervisor found — properties need manual reassignment', {
          uid,
          count: managedProperties.items.length,
        });
      }
    }

    // Remove user from assignedStaff on all properties
    await this.propertyDAO.updateMany(
      { cuid, assignedStaff: user._id },
      { $pull: { assignedStaff: user._id } }
    );

    // Vendor cleanup — archive linked vendor accounts
    if (roles.includes(IUserRole.VENDOR as string) && !clientConnection?.linkedVendorUid) {
      try {
        const vendor = await this.vendorService.getVendorByUserId(userId);

        if (vendor && vendor.vuid) {
          const linkedUsers = await this.userDAO.getLinkedVendorUsers(userId, cuid);

          if (linkedUsers.items.length > 0) {
            const companyName =
              client?.displayName ||
              (client as any)?.companyProfile?.legalEntityName ||
              'your account';

            const userQueue = this.queueFactory.getQueue('userQueue') as UserQueue;
            await userQueue.addVendorTeamDisconnectJob({
              primaryVendorUserId: userId,
              vendorId: vendor._id.toString(),
              cuid,
              clientId: client?._id.toString() || '',
              companyName,
            });
          }

          await this.vendorService.disconnectFromClient(vendor._id.toString(), cuid);
          this.log.info('Vendor disconnected from client', { uid, vendorId: vendor.vuid });
        }
      } catch (error: any) {
        this.log.error('Error handling vendor cleanup during anonymisation:', {
          uid,
          error: error.message,
        });
      }
    }

    // Disconnect user from this client
    const disconnectFields: Record<string, any> = {
      'cuids.$[elem].isConnected': false,
    };

    if (roles.includes('tenant')) {
      const lastLeaseResult = await this.leaseDAO.list(
        {
          cuid,
          tenantId: user._id,
          status: {
            $in: [LeaseStatus.EXPIRED, LeaseStatus.TERMINATED, LeaseStatus.CANCELLED],
          },
          deletedAt: null,
        },
        { sort: { 'duration.endDate': -1 }, limit: 1 }
      );
      disconnectFields['cuids.$[elem].isFormerTenant'] = true;
      disconnectFields['cuids.$[elem].leaseExpiredAt'] =
        (lastLeaseResult.items[0] as any)?.duration?.endDate || new Date();
    }

    await this.userDAO.updateById(userId, { $set: disconnectFields }, {
      arrayFilters: [{ 'elem.cuid': cuid }],
    } as any);

    // Emit events for seat tracking and notifications
    this.emitterService.emit(EventTypes.USER_ARCHIVED, {
      userId,
      cuid,
      roles,
      archivedBy: requestedBy,
      createdAt: new Date(),
    });

    this.emitterService.emit(EventTypes.USER_DISCONNECTED, {
      disconnectedBy: requestedBy,
      userId,
      uid: user.uid,
      cuid,
    });

    // Queue disconnection email
    try {
      const emailQueue = this.queueFactory.getQueue('emailQueue') as EmailQueue;
      emailQueue.addToEmailQueue(JOB_NAME.ACCOUNT_DISCONNECTED_JOB, {
        to: user.email,
        subject: 'Your Account Data Has Been Deleted',
        emailType: MailType.ACCOUNT_DISCONNECTED,
        client: { cuid, id: client?._id.toString() || '' },
        data: {
          fullname: user.fullname || user.email,
          companyName:
            client?.displayName ||
            (client as any)?.companyProfile?.legalEntityName ||
            'your account',
          disconnectedAt: new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }),
          roles: roles.join(', '),
        },
      });
    } catch (emailError: any) {
      this.log.error('Failed to queue deletion notification email', { uid, error: emailError });
    }

    // ── PII scrub ─────────────────────────────────────────────────────

    const profile = await this.profileDAO.getProfileByUserId(userId);
    if (!profile) throw new Error(`Profile not found for uid=${uid}`);

    // Anonymise personal info
    await this.profileDAO.updatePersonalInfo(profile._id.toString(), {
      firstName: 'Deleted',
      lastName: 'User',
      displayName: 'Deleted User',
      phoneNumber: '',
      bio: '',
      headline: '',
      location: '',
      dob: undefined,
    });

    // Delete avatar from S3 if it exists
    const avatarKey = profile.personalInfo?.avatar?.key;
    if (avatarKey) {
      try {
        await this.s3Service.deleteFile(avatarKey);
        this.log.info(`Deleted avatar from S3 for uid=${uid}`);
      } catch (error: any) {
        this.log.warn(`Failed to delete avatar from S3 for uid=${uid}: ${error.message}`);
      }
      await this.profileDAO.updateAvatar(profile._id.toString(), {
        url: '',
        filename: '',
        key: '',
      });
    }

    // Anonymise tenant info
    if (profile.tenantInfo) {
      await this.profileDAO.updateTenantInfo(profile._id.toString(), {
        emergencyContact: { name: '', phone: '', email: '', relationship: '' },
        employerInfo: [],
        rentalReferences: [],
      });
    }

    // Anonymise GDPR settings
    await this.profileDAO.updateGDPRSettings(profile._id.toString(), {
      dataProcessingConsent: false,
      processingConsentDate: new Date(),
      retentionExpiryDate: new Date(),
    });

    // Anonymise email on the user document
    const anonymisedEmail = `deleted_${user._id.toString()}@anonymised.invalid`;
    await this.userDAO.updateById(userId, { $set: { email: anonymisedEmail } });

    // Invalidate sessions across all connected clients
    for (const conn of user.cuids || []) {
      await this.authCache.invalidateUserSession(userId, conn.cuid);
      await this.userCache.invalidateUserDetail(conn.cuid, user.uid);
      await this.userCache.invalidateUserLists(conn.cuid);
    }

    this.log.info(`DSAR anonymisation completed for uid=${uid}, cuid=${cuid}`);
  }

  private sanitisePersonalInfo(personalInfo: any): Record<string, any> {
    const { avatar, ...rest } = personalInfo;
    return { ...rest, avatar: avatar?.url ?? null };
  }

  private sanitiseEmployeeInfo(employeeInfo: any): Record<string, any> {
    const { permissions, clientSpecificSettings, ...rest } = employeeInfo;
    return rest;
  }

  private sanitiseLease(lease: any): Record<string, any> {
    return {
      leaseId: lease._id,
      status: lease.status,
      propertyId: lease.propertyId,
      duration: lease.duration,
      fees: { rentAmount: lease.fees?.rentAmount, deposit: lease.fees?.deposit },
      createdAt: lease.createdAt,
    };
  }
}
