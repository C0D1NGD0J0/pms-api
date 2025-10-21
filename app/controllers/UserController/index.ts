import Logger from 'bunyan';
import { Response } from 'express';
import { createLogger } from '@utils/index';
import { UserService } from '@services/index';
import { httpStatusCodes } from '@utils/constants';
import { IUserRoleType } from '@shared/constants/roles.constants';
import { ProfileService } from '@services/profile/profile.service';
import { IUserFilterOptions } from '@dao/interfaces/userDAO.interface';
import { ResourceContext, AppRequest } from '@interfaces/utils.interface';
import { MediaUploadService } from '@services/mediaUpload/mediaUpload.service';

export class UserController {
  private readonly log: Logger;
  private readonly userService: UserService;
  private readonly profileService: ProfileService;
  private readonly mediaUploadService: MediaUploadService;

  constructor({
    userService,
    profileService,
    mediaUploadService,
  }: {
    userService: UserService;
    profileService: ProfileService;
    mediaUploadService: MediaUploadService;
  }) {
    this.log = createLogger('UserController');
    this.userService = userService;
    this.profileService = profileService;
    this.mediaUploadService = mediaUploadService;
  }

  getClientUserInfo = async (req: AppRequest, res: Response) => {
    const { cuid, uid } = req.params;
    const result = await this.userService.getClientUserInfo(cuid, uid, req.context.currentuser);

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

  getFilteredTenants = async (req: AppRequest, res: Response) => {
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

    const result = await this.userService.getTenantsByClient(
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
    const uploadResult = await this.mediaUploadService.handleFiles(req, {
      primaryResourceId: req.context.currentuser?.uid as string,
      uploadedBy: req.context.currentuser?.sub as string,
      resourceContext: ResourceContext.USER_PROFILE,
    });

    const result = await this.profileService.updateUserProfile(req.context, req.body);

    const response = uploadResult.hasFiles
      ? { ...result, fileUpload: uploadResult.message, processedFiles: uploadResult.processedFiles }
      : result;

    res.status(httpStatusCodes.OK).json(response);
  };

  getNotificationPreferences = async (req: AppRequest, res: Response): Promise<void> => {
    const { cuid } = req.params;
    const { userId } = req.query as { userId: string };
    const targetUserId = userId || req.context.currentuser?.sub;

    if (!targetUserId) {
      res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        data: null,
        message: 'User ID is required',
      });
      return;
    }

    const result = await this.profileService.getUserNotificationPreferences(targetUserId, cuid);
    res.status(httpStatusCodes.OK).json(result);
  };

  getTenantsStats = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const result = await this.userService.getTenantsStats(cuid, req.context.currentuser);

    res.status(httpStatusCodes.OK).json(result);
  };

  archiveUser = async (req: AppRequest, res: Response) => {
    const { cuid, uid } = req.params;
    const result = await this.userService.archiveUser(cuid, uid, req.context.currentuser);

    res.status(httpStatusCodes.OK).json(result);
  };

  getTenantUserInfo = async (req: AppRequest, res: Response) => {
    const { cuid, uid } = req.params;
    const result = await this.userService.getTenantUserInfo(cuid, uid, req.context);

    res.status(httpStatusCodes.OK).json(result);
  };

  getClientTenantDetails = async (req: AppRequest, res: Response) => {
    const { cuid, uid } = req.params;
    const { include } = req.query;

    let includeOptions: string[] | undefined;
    if (include) {
      if (Array.isArray(include)) {
        includeOptions = include as string[];
      } else if (typeof include === 'string') {
        includeOptions = [include];
      }
    }

    const result = await this.userService.getClientTenantDetails(
      cuid,
      uid,
      req.context.currentuser,
      includeOptions
    );

    res.status(httpStatusCodes.OK).json(result);
  };

  updateTenantProfile = async (req: AppRequest, res: Response): Promise<void> => {
    const { cuid, uid } = req.params;
    const uploadResult = await this.mediaUploadService.handleFiles(req, {
      primaryResourceId: uid,
      uploadedBy: req.context.currentuser?.sub as string,
      resourceContext: ResourceContext.USER_PROFILE,
    });

    const result = await this.userService.updateTenantProfile(cuid, uid, req.body, req.context);

    const response = uploadResult.hasFiles
      ? { ...result, fileUpload: uploadResult.message, processedFiles: uploadResult.processedFiles }
      : result;

    res.status(httpStatusCodes.OK).json(response);
  };

  deactivateTenant = async (req: AppRequest, res: Response): Promise<void> => {
    const { cuid, uid } = req.params;

    const result = await this.userService.deactivateTenant(cuid, uid, req.context);

    res.status(httpStatusCodes.OK).json(result);
  };
}
