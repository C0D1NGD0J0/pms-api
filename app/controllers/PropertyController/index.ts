import sanitizeHtml from 'sanitize-html';
import { Response, Request } from 'express';
import { httpStatusCodes } from '@utils/index';
import { PropertyService } from '@services/index';

interface IConstructor {
  propertyService: PropertyService;
}

export class PropertyController {
  propertyService: PropertyService;
  constructor({ propertyService }: IConstructor) {
    this.propertyService = propertyService;
  }

  create = async (req: Request, res: Response) => {
    const { cid } = req.params;
    const currentuser = req.currentuser!;

    const newPropertyData = {
      ...req.body,
      description: {
        text: sanitizeHtml(req.body.description?.text || ''),
        html: sanitizeHtml(req.body.description?.html || ''),
      },
    };
    const newProperty = await this.propertyService.createProperty(
      cid,
      newPropertyData,
      currentuser
    );
    res.status(httpStatusCodes.OK).json(newProperty);
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
