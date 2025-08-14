import Logger from 'bunyan';
import { Response } from 'express';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { httpStatusCodes } from '@utils/constants';
import { AppRequest } from '@interfaces/utils.interface';
import { IUserRoleType } from '@interfaces/user.interface';
import { ClientService } from '@services/client/client.service';
import { IUserFilterOptions } from '@dao/interfaces/userDAO.interface';

export class ClientController {
  private readonly log: Logger;
  private readonly clientService: ClientService;

  constructor({ clientService }: { clientService: ClientService }) {
    this.log = createLogger('ClientController');
    this.clientService = clientService;
  }

  updateClientProfile = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const updateData = req.body;

    this.log.info(`Updating client profile for cuid: ${cuid}`);

    const updatedClient = await this.clientService.updateClientDetails(req.context, updateData);

    res.status(httpStatusCodes.OK).json({
      success: true,
      data: updatedClient,
      message: t('client.success.profileUpdated'),
    });
  };

  getClient = async (req: AppRequest, res: Response) => {
    this.log.info('Getting complete client information for cuid');

    const client = await this.clientService.getClientDetails(req.context);

    res.status(httpStatusCodes.OK).json({
      success: true,
      data: client,
      message: t('client.success.detailsRetrieved'),
    });
  };

  assignUserRole = async (req: AppRequest, res: Response) => {
    const { uid } = req.params;
    const { role } = req.body;
    const result = await this.clientService.assignUserRole(req.context, uid, role);
    res.status(httpStatusCodes.OK).json(result);
  };

  removeUserRole = async (req: AppRequest, res: Response) => {
    const { uid, role } = req.params;
    const result = await this.clientService.removeUserRole(req.context, uid, role as any);
    res.status(httpStatusCodes.OK).json(result);
  };

  getUserRoles = async (req: AppRequest, res: Response) => {
    const { uid } = req.params;
    const result = await this.clientService.getUserRoles(req.context, uid);
    res.status(httpStatusCodes.OK).json(result);
  };

  disconnectUser = async (req: AppRequest, res: Response) => {
    const { uid } = req.params;
    const result = await this.clientService.disconnectUser(req.context, uid);
    res.status(httpStatusCodes.OK).json(result);
  };

  reconnectUser = async (req: AppRequest, res: Response) => {
    const { uid } = req.params;
    const result = await this.clientService.reconnectUser(req.context, uid);
    res.status(httpStatusCodes.OK).json(result);
  };

  getClientUsers = async (req: AppRequest, res: Response) => {
    this.log.info('Getting client users with roles and connections');

    const result = await this.clientService.getClientUsers(req.context);

    res.status(httpStatusCodes.OK).json(result);
  };

  /**
   * Get users by specific role for a client
   */
  getUsersByRole = async (req: AppRequest, res: Response) => {
    const { role } = req.params;
    const result = await this.clientService.getUsersByRole(req.context, role as any);

    res.status(httpStatusCodes.OK).json(result);
  };

  /**
   * Get users filtered by type (employee, tenant, vendor) and other criteria
   * This endpoint supports querying users by type, role, department, status, and search terms
   */
  getFilteredUsers = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const { type, role, department, status, search, page, limit, sortBy, sort } = req.query;

    this.log.info('Getting filtered users', {
      cuid,
      type,
      role,
      department,
      status,
      page,
      limit,
    });

    // Prepare filter options
    const filterOptions: IUserFilterOptions = {
      role: role as IUserRoleType | IUserRoleType[] | undefined,
      department: department as string | undefined,
      status: status as 'active' | 'inactive' | undefined,
      search: search as string | undefined,
    };

    // Prepare pagination options
    const paginationOpts = {
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 10,
      sortBy: sortBy as string | undefined,
      sort: sort as 'asc' | 'desc' | undefined,
      skip:
        ((page ? parseInt(page as string, 10) : 1) - 1) *
        (limit ? parseInt(limit as string, 10) : 10),
    };

    const result = await this.clientService.getFilteredUsers(
      cuid as string,
      req.context.currentuser!,
      filterOptions,
      paginationOpts
    );

    res.status(httpStatusCodes.OK).json(result);
  };
}
