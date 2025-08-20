import Logger from 'bunyan';
import { Response } from 'express';
import { createLogger } from '@utils/index';
import { httpStatusCodes } from '@utils/constants';
import { AppRequest } from '@interfaces/utils.interface';
import { UserService } from '@services/user/user.service';
import { IUserRoleType } from '@interfaces/user.interface';
import { IUserFilterOptions } from '@dao/interfaces/userDAO.interface';

export class UserController {
  private readonly log: Logger;
  private readonly userService: UserService;

  constructor({ userService }: { userService: UserService }) {
    this.log = createLogger('UserController');
    this.userService = userService;
  }

  getClientUsers = async (req: AppRequest, res: Response) => {
    const result = await this.userService.getClientUsers(req.context);

    res.status(httpStatusCodes.OK).json(result);
  };

  getUsersByRole = async (req: AppRequest, res: Response) => {
    const { role } = req.params;
    const result = await this.userService.getUsersByRole(req.context, role as any);

    res.status(httpStatusCodes.OK).json(result);
  };

  getFilteredUsers = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const { role, department, status, search, page, limit, sortBy, sort } = req.query;

    const filterOptions: IUserFilterOptions = {
      role: role as IUserRoleType | IUserRoleType[] | undefined,
      department: department as string | undefined,
      status: status as 'active' | 'inactive' | undefined,
      search: search as string | undefined,
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
      req.context.currentuser!,
      filterOptions,
      paginationOpts
    );

    res.status(httpStatusCodes.OK).json(result);
  };
}
