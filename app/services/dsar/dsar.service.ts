import Logger from 'bunyan';
import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import { createLogger } from '@utils/index';
import { ProfileDAO } from '@dao/profileDAO';
import { PropertyDAO } from '@dao/propertyDAO';
import { UserCache } from '@caching/user.cache';
import { AuthCache } from '@caching/auth.cache';
import { S3Service } from '@services/fileUpload';
import { LeaseStatus } from '@interfaces/lease.interface';

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

interface IConstructor {
  propertyDAO: PropertyDAO;
  profileDAO: ProfileDAO;
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
  private readonly userDAO: UserDAO;
  private readonly leaseDAO: LeaseDAO;
  private readonly userCache: UserCache;
  private readonly authCache: AuthCache;
  private readonly s3Service: S3Service;

  constructor({
    propertyDAO,
    profileDAO,
    userDAO,
    leaseDAO,
    userCache,
    authCache,
    s3Service,
  }: IConstructor) {
    this.log = createLogger('DSARService');
    this.propertyDAO = propertyDAO;
    this.profileDAO = profileDAO;
    this.userDAO = userDAO;
    this.leaseDAO = leaseDAO;
    this.userCache = userCache;
    this.authCache = authCache;
    this.s3Service = s3Service;
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

  async anonymiseUser(uid: string, cuid: string, requestedBy: string): Promise<void> {
    this.log.info(`DSAR anonymisation requested for uid=${uid}, cuid=${cuid}, by=${requestedBy}`);

    const user = await this.userDAO.getUserByUId(uid);
    if (!user) throw new Error(`User ${uid} not found`);

    // Verify user belongs to the requesting client
    const connection = user.cuids?.find((c: any) => c.cuid === cuid);
    if (!connection) {
      throw new Error(`User ${uid} is not associated with client ${cuid}`);
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
        await this.profileDAO.updateAvatar(profile._id.toString(), {
          url: '',
          filename: '',
          key: '',
        });
        this.log.info(`Deleted avatar from S3 for uid=${uid}`);
      } catch (error: any) {
        this.log.warn(`Failed to delete avatar from S3 for uid=${uid}: ${error.message}`);
      }
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
