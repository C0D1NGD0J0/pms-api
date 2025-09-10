import Logger from 'bunyan';
import { Response } from 'express';
import { createLogger } from '@utils/index';
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

  constructor({
    userService,
    profileService,
  }: {
    userService: UserService;
    profileService: ProfileService;
  }) {
    this.log = createLogger('UserController');
    this.userService = userService;
    this.profileService = profileService;
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
    const result = await this.profileService.updateUserProfile(req.context, req.body);

    res.status(httpStatusCodes.OK).json(result);
  };
}
