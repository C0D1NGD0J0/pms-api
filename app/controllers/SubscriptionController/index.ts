import Logger from 'bunyan';
import { Response, Request } from 'express';
import { SubscriptionService } from '@services/index';
import { AppRequest } from '@interfaces/utils.interface';
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
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'User not authenticated or no active account',
      });
    }

    const result = await this.subscriptionService.getSubscriptionPlanUsage(req.context);

    if (!result.success) {
      return res.status(httpStatusCodes.BAD_REQUEST).json(result);
    }

    res.status(httpStatusCodes.OK).json(result);
  };
}
