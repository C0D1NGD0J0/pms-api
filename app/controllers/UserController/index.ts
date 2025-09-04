import Logger from 'bunyan';
import { Response } from 'express';
import { createLogger } from '@utils/index';
import { ProfileDAO } from '@dao/profileDAO';
import { httpStatusCodes } from '@utils/constants';
import { AppRequest } from '@interfaces/utils.interface';
import { UserService } from '@services/user/user.service';
import { IUserRoleType } from '@interfaces/user.interface';
import { ProfileService } from '@services/profile/profile.service';
import { IUserFilterOptions } from '@dao/interfaces/userDAO.interface';

export class UserController {
  private readonly log: Logger;
  private readonly userService: UserService;
  private readonly profileService: ProfileService;
  private readonly profileDAO: ProfileDAO;

  constructor({
    userService,
    profileService,
    profileDAO,
  }: {
    userService: UserService;
    profileService: ProfileService;
    profileDAO: ProfileDAO;
  }) {
    this.log = createLogger('UserController');
    this.userService = userService;
    this.profileService = profileService;
    this.profileDAO = profileDAO;
  }

  getClientUserInfo = async (req: AppRequest, res: Response) => {
    const { uid } = req.params;
    const result = await this.userService.getClientUserInfo(req.context, uid);

    res.status(httpStatusCodes.OK).json(result);
  };

  getUsersByRole = async (req: AppRequest, res: Response) => {
    const { role } = req.params;
    const result = await this.userService.getUsersByRole(req.context, role as any);

    res.status(httpStatusCodes.OK).json(result);
  };

  getFilteredUsers = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const { role, department, status, page, limit, sortBy, sort } = req.query;

    const filterOptions: IUserFilterOptions = {
      role: role as IUserRoleType | IUserRoleType[] | undefined,
      department: department as string | undefined,
      status: status as 'active' | 'inactive' | undefined,
    };

    const paginationOpts = {
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 10,
      sortBy: sortBy as string | undefined,
      sort: sort as 'asc' | 'desc' | undefined,
      skip:
        ((page ? parseInt(page as string, 10) : 1) - 1) *
        (limit ? parseInt(limit as string, 10) : 10),
    };

    const result = await this.userService.getFilteredUsers(
      cuid as string,
      filterOptions,
      paginationOpts
    );

    res.status(httpStatusCodes.OK).json(result);
  };

  getUserStats = async (req: AppRequest, res: Response): Promise<void> => {
    const { cuid } = req.params;

    const result = await this.userService.getUserStats(cuid, {
      ...req.query,
    });

    res.status(httpStatusCodes.OK).json(result);
  };

  getUserProfile = async (req: AppRequest, res: Response): Promise<void> => {
    const { uid } = req.query as { uid: string | undefined };
    const result = await this.profileService.getUserProfileForEdit(req.context, uid);

    res.status(httpStatusCodes.OK).json(result);
  };

  updateUserProfile = async (req: AppRequest, res: Response): Promise<void> => {
    const { uid, cuid } = req.params;
    const {
      userInfo,
      personalInfo,
      settings,
      identification,
      profileMeta,
      employeeInfo,
      vendorInfo,
    } = req.body;
    const currentUser = req.context.currentuser!;

    // Check if user can update this profile
    // Either it's their own profile or they have admin/manager role in this client
    if (
      currentUser.uid !== uid &&
      !(currentUser.client.cuid === cuid && ['manager', 'admin'].includes(currentUser.client.role))
    ) {
      res.status(httpStatusCodes.FORBIDDEN).json({
        success: false,
        message: 'Insufficient permissions to update this profile',
      });
      return;
    }

    // Get user's profile ID and role information
    const userData = await this.userService.getClientUserInfo(req.context, uid);
    if (!userData.success || !userData.data) {
      res.status(httpStatusCodes.NOT_FOUND).json({
        success: false,
        message: 'User not found',
      });
      return;
    }

    // For profile ID, we need to access the user's profile document
    // The getClientUserInfo returns user details but we need the actual profile _id
    // We can get it from the user's profile field or create a simple method to get profile ID
    const profileId = await this.getUserProfileId(uid);
    if (!profileId) {
      res.status(httpStatusCodes.NOT_FOUND).json({
        success: false,
        message: 'User profile not found',
      });
      return;
    }

    // Get user role from the returned data
    const userRole = userData.data.profile.roles?.[0] as IUserRoleType;

    // Prepare profile data for update
    const profileData = {
      userInfo,
      personalInfo,
      settings,
      identification,
      profileMeta,
      employeeInfo,
      vendorInfo,
    };

    const result = await this.profileService.updateProfileWithRoleInfo(
      profileId,
      cuid,
      profileData,
      userRole
    );

    res.status(httpStatusCodes.OK).json(result);
  };

  private async getUserProfileId(uid: string): Promise<string | null> {
    try {
      const profile = await this.profileDAO.getProfileByUserId(uid);
      return profile?._id.toString() || null;
    } catch (error) {
      this.log.error('Error getting user profile ID:', error);
      return null;
    }
  }
}
