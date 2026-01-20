import Logger from 'bunyan';
import { Response, Request } from 'express';
import { SubscriptionService } from '@services/index';
import { AppRequest } from '@interfaces/utils.interface';
import { UnauthorizedError } from '@shared/customErrors';
import { httpStatusCodes, createLogger } from '@utils/index';

interface IConstructor {
  subscriptionService: SubscriptionService;
}

export class SubscriptionController {
  private readonly log: Logger;
  private readonly subscriptionService: SubscriptionService;

  constructor({ subscriptionService }: IConstructor) {
    this.log = createLogger('SubscriptionController');
    this.subscriptionService = subscriptionService;
  }

  getSubscriptionPlans = async (req: Request, res: Response) => {
    const result = await this.subscriptionService.getSubscriptionPlans();

    res.status(httpStatusCodes.OK).json(result);
  };

  getPlanUsage = async (req: AppRequest, res: Response) => {
    const { currentuser } = req.context;

    if (!currentuser || !currentuser.client.cuid) {
      throw new UnauthorizedError({ message: 'Unauthorized access to client data.' });
    }

    const result = await this.subscriptionService.getSubscriptionPlanUsage(req.context);
    res.status(httpStatusCodes.OK).json(result);
  };
}
