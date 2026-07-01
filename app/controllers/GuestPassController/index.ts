import { Response } from 'express';
import { GuestPassService } from '@services/index';
import { AppRequest } from '@interfaces/utils.interface';

export class GuestPassController {
  private readonly guestPassService: GuestPassService;

  constructor({ guestPassService }: { guestPassService: GuestPassService }) {
    this.guestPassService = guestPassService;
  }

  createPass = async (req: AppRequest, res: Response) => {
    const result = await this.guestPassService.createGuestPass(req.context, req.body);
    return res.status(201).json(result);
  };

  getMyPasses = async (req: AppRequest, res: Response) => {
    const result = await this.guestPassService.getMyPasses(req.context, req.query as any);
    return res.status(200).json(result);
  };

  revokePass = async (req: AppRequest, res: Response) => {
    const { vpuid } = req.params;
    const result = await this.guestPassService.revokePass(req.context, vpuid);
    return res.status(200).json(result);
  };

  getStats = async (req: AppRequest, res: Response) => {
    const { pid } = req.query as { pid?: string };
    const result = await this.guestPassService.getStats(req.context, pid);
    return res.status(200).json(result);
  };
}
