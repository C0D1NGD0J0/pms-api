import Logger from 'bunyan';
import { Response } from 'express';
import { createLogger } from '@utils/index';
import { httpStatusCodes } from '@utils/constants';
import { AppRequest } from '@interfaces/utils.interface';
import { OffboardingService } from '@services/offboarding/offboarding.service';

export class OffboardingController {
  private readonly log: Logger;
  private readonly offboardingService: OffboardingService;

  constructor({ offboardingService }: { offboardingService: OffboardingService }) {
    this.log = createLogger('OffboardingController');
    this.offboardingService = offboardingService;
  }

  submitVacateRequest = async (req: AppRequest, res: Response) => {
    const { cuid, luid } = req.params;
    const result = await this.offboardingService.submitVacateRequest(
      cuid,
      luid,
      req.body,
      req.context
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  decideVacateRequest = async (req: AppRequest, res: Response) => {
    const { cuid, luid } = req.params;
    const result = await this.offboardingService.decideVacateRequest(
      cuid,
      luid,
      req.body,
      req.context
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  getPendingVacateRequests = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const result = await this.offboardingService.getPendingVacateRequests(cuid);
    res.status(httpStatusCodes.OK).json(result);
  };

  getActiveOffboardings = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const result = await this.offboardingService.getActiveOffboardings(cuid);
    res.status(httpStatusCodes.OK).json(result);
  };

  getOffboardingStatus = async (req: AppRequest, res: Response) => {
    const { cuid, luid } = req.params;
    const result = await this.offboardingService.getOffboardingStatus(cuid, luid);
    res.status(httpStatusCodes.OK).json(result);
  };
}
