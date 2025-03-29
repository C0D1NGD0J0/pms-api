import { Response, Request } from 'express';
import { httpStatusCodes } from '@utils/index';

interface IConstructor {}

export class PropertyController {
  constructor({}: IConstructor) {}

  create = async (req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  getAllProperties = async (req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  getPropertyUnits = async (req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  getProeprty = async (req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  updateProperty = async (req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  achiveProperty = async (req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  verifyOccupancyStatus = async (req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  searchProperty = async (req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  addMediaToProperty = async (req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  deleteMediaFromProperty = async (req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  checkAvailability = async (req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  getNearbyProperties = async (req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  restorArchivedProperty = async (req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };
}
