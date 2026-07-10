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

  validateCode = async (req: AppRequest, res: Response) => {
    const result = await this.guestPassService.validateCode(req.context, req.body);
    return res.status(200).json(result);
  };

  getExpectedVisitors = async (req: AppRequest, res: Response) => {
    const result = await this.guestPassService.getExpectedVisitors(req.context, req.query as any);
    return res.status(200).json(result);
  };

  acknowledgePass = async (req: AppRequest, res: Response) => {
    const { vpuid } = req.params;
    const result = await this.guestPassService.acknowledgePass(req.context, vpuid);
    return res.status(200).json(result);
  };

  bulkAcknowledge = async (req: AppRequest, res: Response) => {
    const result = await this.guestPassService.bulkAcknowledgePasses(req.context, req.body.passIds);
    return res.status(200).json(result);
  };

  getUnacknowledged = async (req: AppRequest, res: Response) => {
    const { propertyId } = req.params;
    const result = await this.guestPassService.getUnacknowledgedPasses(req.context, propertyId);
    return res.status(200).json(result);
  };

  getUnacknowledgedCount = async (req: AppRequest, res: Response) => {
    const { propertyId } = req.query as { propertyId?: string };
    const result = await this.guestPassService.getUnacknowledgedCount(req.context, propertyId);
    return res.status(200).json(result);
  };
}
