import Logger from 'bunyan';
import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import { createLogger } from '@utils/index';
import { ProfileDAO } from '@dao/profileDAO';
import { PropertyDAO } from '@dao/propertyDAO';
import { UserCache } from '@caching/user.cache';
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

  constructor({ propertyDAO, profileDAO, userDAO, leaseDAO, userCache }: IConstructor) {
    this.log = createLogger('DSARService');
    this.propertyDAO = propertyDAO;
    this.profileDAO = profileDAO;
    this.userDAO = userDAO;
    this.leaseDAO = leaseDAO;
    this.userCache = userCache;
  }

  async exportUserData(userId: string): Promise<DSARExport> {
    this.log.info(`DSAR export requested for userId=${userId}`);

    const [user, profile] = await Promise.all([
      this.userDAO.getUserById(userId),
      this.profileDAO.getProfileByUserId(userId),
    ]);

    if (!user) throw new Error(`User ${userId} not found`);

    const { items: leases } = await this.leaseDAO.list({ tenantId: userId, deletedAt: null });

    const exported: DSARExport = {
      exportedAt: new Date().toISOString(),
      userId,
      account: {
        email: user.email,
        uid: user.uid,
        isActive: user.isActive,
        createdAt: user.createdAt,
        clientMemberships: (user.cuids ?? []).map((c: any) => ({
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

    this.log.info(`DSAR export completed for userId=${userId}`);
    return exported;
  }

  async anonymiseUser(userId: string, requestedBy: string): Promise<void> {
    this.log.info(`DSAR anonymisation requested for userId=${userId} by=${requestedBy}`);

    // Pre-flight guards: block anonymisation when user has active obligations
    const user = await this.userDAO.getUserById(userId);
    if (!user) throw new Error(`User ${userId} not found`);

    const PM_ROLES = ['super-admin', 'admin', 'manager'];

    for (const connection of user.cuids || []) {
      if (!connection.isConnected) continue;

      const roles: string[] = connection.roles || [];
      const cuid = connection.cuid;
      const clientLabel = connection.clientDisplayName || cuid;

      // Guard: tenant with active lease
      if (roles.includes('tenant')) {
        const activeLease = await this.leaseDAO.getActiveLeaseByTenant(cuid, user.uid);
        if (activeLease) {
          throw new Error(
            `Cannot anonymise: user has an active lease (${clientLabel}). Terminate lease first.`
          );
        }
      }

      // Guard: PM/admin managing properties with active leases
      if (roles.some((r) => PM_ROLES.includes(r))) {
        const managed = await this.propertyDAO.getPropertiesByClientId(
          cuid,
          { managedBy: user._id.toString(), deletedAt: null },
          { limit: 1000 }
        );

        if (managed.items.length > 0) {
          const propIds = managed.items.map((p: any) => p._id);
          const activeLeases = await this.leaseDAO.list(
            {
              cuid,
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
    if (!profile) throw new Error(`Profile not found for userId=${userId}`);

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

    if (profile.tenantInfo) {
      await this.profileDAO.updateTenantInfo(profile._id.toString(), {
        emergencyContact: { name: '', phone: '', email: '', relationship: '' },
        employerInfo: [],
        rentalReferences: [],
      });
    }

    await this.profileDAO.updateGDPRSettings(profile._id.toString(), {
      dataProcessingConsent: false,
      processingConsentDate: new Date(),
      retentionExpiryDate: new Date(),
    });

    for (const connection of user.cuids || []) {
      await this.userCache.invalidateUserDetail(connection.cuid, user.uid);
      await this.userCache.invalidateUserLists(connection.cuid);
    }

    this.log.info(`DSAR anonymisation completed for userId=${userId}`);
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
