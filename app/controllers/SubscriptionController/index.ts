import Logger from 'bunyan';
import { Response, Request } from 'express';
import { SubscriptionService } from '@services/index';
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
}
