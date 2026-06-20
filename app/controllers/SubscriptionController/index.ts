import Logger from 'bunyan';
import { Response, Request } from 'express';
import { AppRequest } from '@interfaces/utils.interface';
import { ROLES } from '@shared/constants/roles.constants';
import { httpStatusCodes, createLogger } from '@utils/index';
import { SubscriptionService, SMSService } from '@services/index';
import { UnauthorizedError, ForbiddenError } from '@shared/customErrors';

interface IConstructor {
  subscriptionService: SubscriptionService;
  smsService: SMSService;
}

export class SubscriptionController {
  private readonly log: Logger;
  private readonly smsService: SMSService;
  private readonly subscriptionService: SubscriptionService;

  constructor({ subscriptionService, smsService }: IConstructor) {
    this.log = createLogger('SubscriptionController');
    this.subscriptionService = subscriptionService;
    this.smsService = smsService;
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

  initSubscriptionPayment = async (req: AppRequest, res: Response) => {
    const { currentuser } = req.context;
    const { cuid } = req.params;

    if (!currentuser || currentuser.client.cuid !== cuid) {
      throw new UnauthorizedError({ message: 'Unauthorized access' });
    }

    if (currentuser.client.role !== ROLES.SUPER_ADMIN) {
      throw new ForbiddenError({ message: 'Only account owner can manage billing' });
    }

    const result = await this.subscriptionService.initSubscriptionPayment(req.context, req.body);

    res.status(httpStatusCodes.OK).json(result);
  };

  cancelSubscription = async (req: AppRequest, res: Response) => {
    const { currentuser } = req.context;
    const { cuid } = req.params;

    if (!currentuser || currentuser.client.cuid !== cuid) {
      throw new UnauthorizedError({ message: 'Unauthorized access' });
    }

    if (currentuser.client.role !== ROLES.SUPER_ADMIN) {
      throw new ForbiddenError({ message: 'Only account owner can cancel subscription' });
    }

    const result = await this.subscriptionService.cancelSubscription(req.context);

    res.status(httpStatusCodes.OK).json(result);
  };

  syncFromStripe = async (req: AppRequest, res: Response) => {
    const { currentuser } = req.context;
    const { cuid } = req.params;

    if (!currentuser || currentuser.client.cuid !== cuid) {
      throw new UnauthorizedError({ message: 'Unauthorized access' });
    }

    if (currentuser.client.role !== ROLES.SUPER_ADMIN) {
      throw new ForbiddenError({ message: 'Only account owner can sync subscription' });
    }

    const result = await this.subscriptionService.syncFromStripe(cuid);
    res.status(httpStatusCodes.OK).json(result);
  };

  manageSeats = async (req: AppRequest, res: Response) => {
    const { currentuser } = req.context;
    const { cuid } = req.params;
    const { seatDelta } = req.body;

    if (!currentuser || currentuser.client.cuid !== cuid) {
      throw new UnauthorizedError({ message: 'Unauthorized access' });
    }

    if (currentuser.client.role !== ROLES.SUPER_ADMIN) {
      throw new ForbiddenError({ message: 'Only account owner can manage seats' });
    }

    const result = await this.subscriptionService.updateAdditionalSeats(cuid, seatDelta);

    res.status(httpStatusCodes.OK).json(result);
  };

  getSMSQuota = async (req: AppRequest, res: Response): Promise<Response> => {
    const { cuid } = req.params;
    const { currentuser } = req.context;

    if (!currentuser || currentuser.client.cuid !== cuid) {
      throw new UnauthorizedError({ message: 'Unauthorized access' });
    }

    if (currentuser.client.role !== ROLES.SUPER_ADMIN) {
      throw new ForbiddenError({ message: 'Only account owner can view SMS quota' });
    }

    const quota = await this.smsService.getQuotaStatus(cuid);
    return res.status(200).json(quota);
  };

  getSMSLogs = async (req: AppRequest, res: Response): Promise<Response> => {
    const { cuid } = req.params;
    const { currentuser } = req.context;

    if (!currentuser || currentuser.client.cuid !== cuid) {
      throw new UnauthorizedError({ message: 'Unauthorized access' });
    }

    if (currentuser.client.role !== ROLES.SUPER_ADMIN) {
      throw new ForbiddenError({ message: 'Only account owner can view SMS logs' });
    }

    const result = await this.smsService.getSMSHistory(cuid, req.query as any);
    return res.status(200).json(result);
  };
}
