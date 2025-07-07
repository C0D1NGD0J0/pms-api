import Logger from 'bunyan';
import { Response } from 'express';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { httpStatusCodes } from '@utils/constants';
import { AppRequest } from '@interfaces/utils.interface';
import { ClientService } from '@services/client/client.service';

export class ClientController {
  private readonly log: Logger;
  private readonly clientService: ClientService;

  constructor({ clientService }: { clientService: ClientService }) {
    this.log = createLogger('ClientController');
    this.clientService = clientService;
  }

  updateClientProfile = async (req: AppRequest, res: Response) => {
    const { cid } = req.params;
    const updateData = req.body;

    this.log.info(`Updating client profile for cid: ${cid}`);

    const updatedClient = await this.clientService.updateClientDetails(req.context, updateData);

    res.status(httpStatusCodes.OK).json({
      success: true,
      data: updatedClient,
      message: t('client.success.profileUpdated'),
    });
  };

  getClient = async (req: AppRequest, res: Response) => {
    this.log.info('Getting complete client information for cid');

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
}
