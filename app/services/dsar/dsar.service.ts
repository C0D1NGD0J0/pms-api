import Logger from 'bunyan';
import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import { createLogger } from '@utils/index';
import { ProfileDAO } from '@dao/profileDAO';

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
  profileDAO: ProfileDAO;
  leaseDAO: LeaseDAO;
  userDAO: UserDAO;
}

export class DSARService {
  private readonly log: Logger;
  private readonly profileDAO: ProfileDAO;
  private readonly userDAO: UserDAO;
  private readonly leaseDAO: LeaseDAO;

  constructor({ profileDAO, userDAO, leaseDAO }: IConstructor) {
    this.log = createLogger('DSARService');
    this.profileDAO = profileDAO;
    this.userDAO = userDAO;
    this.leaseDAO = leaseDAO;
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
      fees: { monthlyRent: lease.fees?.monthlyRent, deposit: lease.fees?.deposit },
      createdAt: lease.createdAt,
    };
  }
}
