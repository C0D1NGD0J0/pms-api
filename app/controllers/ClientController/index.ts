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
    const { currentuser } = req.context;
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
}
