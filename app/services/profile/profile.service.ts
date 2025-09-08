import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { IUserRoleType } from '@interfaces/user.interface';
import { ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { ISuccessReturnData } from '@interfaces/utils.interface';
import { IProfileDocument } from '@interfaces/profile.interface';
import { ProfileValidations } from '@shared/validations/ProfileValidation';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';

interface IConstructor {
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

export class ProfileService {
  private readonly profileDAO: ProfileDAO;
  private readonly clientDAO: ClientDAO;
  private readonly userDAO: UserDAO;
  private readonly logger: Logger;

  constructor({ profileDAO, clientDAO, userDAO }: IConstructor) {
    this.profileDAO = profileDAO;
    this.clientDAO = clientDAO;
    this.userDAO = userDAO;
    this.logger = createLogger('ProfileService');
  }

  /**
   * Update role-specific information for a profile and client
   */
  async updateRoleInfo(
    profileId: string,
    cuid: string,
    roleData: any,
    userRole: IUserRoleType,
    roleType: 'employee' | 'vendor'
  ): Promise<ISuccessReturnData<IProfileDocument>> {
    try {
      const validation =
        roleType === 'employee'
          ? ProfileValidations.updateEmployeeInfo.safeParse(roleData)
          : ProfileValidations.updateVendorInfo.safeParse(roleData);

      if (!validation.success) {
        throw new BadRequestError({
          message: `Validation failed: ${validation.error.issues.map((i) => i.message).join(', ')}`,
        });
      }

      // Role-based permission checks
      if (roleType === 'employee' && !['manager', 'staff', 'admin'].includes(userRole)) {
        throw new ForbiddenError({
          message: t('auth.errors.insufficientPermissions'),
        });
      }

      if (roleType === 'vendor' && userRole !== 'vendor') {
        throw new ForbiddenError({
          message: t('auth.errors.insufficientPermissions'),
        });
      }

      await this.ensureClientRoleInfo(profileId, cuid);

      const result =
        roleType === 'employee'
          ? await this.profileDAO.updateEmployeeInfo(profileId, cuid, validation.data)
          : await this.profileDAO.updateVendorInfo(profileId, cuid, validation.data);

      if (!result) {
        throw new NotFoundError({
          message: t('profile.errors.notFound'),
        });
      }

      this.logger.info(`${roleType} info updated for profile ${profileId}, client ${cuid}`);

      return {
        success: true,
        data: result,
        message:
          roleType === 'employee'
            ? t('profile.success.employeeInfoUpdated')
            : t('profile.success.vendorInfoUpdated'),
      };
    } catch (error) {
      this.logger.error(`Error updating ${roleType} info for profile ${profileId}:`, error);
      throw error;
    }
  }

  /**
   * Update common role information that applies across all clients
   */
  async updateCommonRoleInfo(
    profileId: string,
    roleData: any,
    userRole: IUserRoleType,
    roleType: 'employee' | 'vendor'
  ): Promise<ISuccessReturnData<IProfileDocument>> {
    try {
      const validation =
        roleType === 'employee'
          ? ProfileValidations.updateEmployeeInfo.safeParse(roleData)
          : ProfileValidations.updateVendorInfo.safeParse(roleData);

      if (!validation.success) {
        throw new BadRequestError({
          message: `Validation failed: ${validation.error.issues.map((i) => i.message).join(', ')}`,
        });
      }

      // Role-based permission checks
      if (roleType === 'employee' && !['manager', 'staff', 'admin'].includes(userRole)) {
        throw new ForbiddenError({
          message: t('auth.errors.insufficientPermissions'),
        });
      }

      if (roleType === 'vendor' && userRole !== 'vendor') {
        throw new ForbiddenError({
          message: t('auth.errors.insufficientPermissions'),
        });
      }

      const result =
        roleType === 'employee'
          ? await this.profileDAO.updateCommonEmployeeInfo(profileId, validation.data)
          : await this.profileDAO.updateCommonVendorInfo(profileId, validation.data);

      if (!result) {
        throw new NotFoundError({
          message: t('profile.errors.notFound'),
        });
      }

      this.logger.info(`Common ${roleType} info updated for profile ${profileId}`);

      return {
        success: true,
        data: result,
        message:
          roleType === 'employee'
            ? t('profile.success.commonEmployeeInfoUpdated')
            : t('profile.success.commonVendorInfoUpdated'),
      };
    } catch (error) {
      this.logger.error(`Error updating common ${roleType} info for profile ${profileId}:`, error);
      throw error;
    }
  }

  /**
   * Helper method to ensure a client role exists for a user
   * Now implemented using UserDAO directly
   */
  private async ensureClientRoleInfo(
    userId: string,
    cuid: string,
    role?: string,
    linkedVendorId?: string
  ): Promise<void> {
    try {
      if (!userId || !cuid) {
        throw new BadRequestError({
          message: 'Profile not found',
        });
      }

      const [clientInfo, userInfo] = await Promise.all([
        this.clientDAO.getClientByCuid(cuid),
        this.userDAO.getUserById(userId),
      ]);

      if (!userInfo || !clientInfo) {
        throw new NotFoundError({
          message: t('user.errors.notFound'),
        });
      }

      const hasClientConnection = userInfo.cuids.some((c) => c.cuid === cuid);

      if (!hasClientConnection) {
        await this.userDAO.updateById(userId, {
          $push: {
            cuids: {
              cuid,
              roles: [role || ('vendor' as IUserRoleType)],
              isConnected: true,
              displayName: clientInfo.displayName,
              linkedVendorId: role === 'vendor' ? linkedVendorId : null,
            },
          },
        });
      }
    } catch (error) {
      this.logger.error(`Error ensuring client role info: ${error.message}`);
      throw error;
    }
  }

  /**
   * Initialize role-specific information for new users during invitation acceptance
   */
  async initializeRoleInfo(
    userId: string,
    cuid: string,
    role: IUserRoleType,
    linkedVendorId?: string,
    metadata?: {
      employeeInfo?: any;
      vendorInfo?: any;
    }
  ): Promise<ISuccessReturnData<IProfileDocument>> {
    await this.ensureClientRoleInfo(userId, cuid, role, linkedVendorId);
    const profile = await this.profileDAO.findFirst({ user: new Types.ObjectId(userId) });
    if (!profile) {
      throw new NotFoundError({
        message: t('profile.errors.notFound'),
      });
    }

    let result: IProfileDocument | null = null;

    if (role === 'vendor' && !linkedVendorId) {
      // For primary vendors, initialize the common vendor info with metadata if provided
      const vendorData = metadata?.vendorInfo || {};
      const vendorResult = await this.updateCommonRoleInfo(
        profile.id,
        vendorData,
        'admin',
        'vendor'
      );
      result = vendorResult.data;
      this.logger.info(`Initialized vendor info for profile ${profile.id} with metadata`);
    } else if (['manager', 'staff', 'admin'].includes(role)) {
      // For employees, initialize the common employee info with metadata if provided
      const employeeData = metadata?.employeeInfo || {};
      const employeeResult = await this.updateCommonRoleInfo(
        profile.id,
        employeeData,
        'admin',
        'employee'
      );
      result = employeeResult.data;
      this.logger.info(`Initialized employee info for profile ${profile.id} with metadata`);
    } else {
      result = profile;
    }
    if (!result) {
      throw new NotFoundError({
        message: 'Error initializing user role.',
      });
    }
    return {
      success: true,
      data: result,
      message: t('profile.success.roleInitialized'),
    };
  }
}
