import sanitizeHtml from 'sanitize-html';
import { Response, Request } from 'express';
import { httpStatusCodes } from '@utils/index';
import { PropertyService } from '@services/index';
import { ExtractedMediaFile, IPaginationQuery } from '@interfaces/utils.interface';

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
    const newProperty = await this.propertyService.addProperty(cid, newPropertyData, currentuser);
    res.status(httpStatusCodes.OK).json({ success: true, data: newProperty });
  };

  validateCsv = async (req: Request, res: Response) => {
    const { cid } = req.params;
    const currentuser = req.currentuser!;

    if (!req.body.scannedFiles) {
      return res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: 'No CSV file uploaded',
      });
    }
    const csvFile: ExtractedMediaFile = req.body.scannedFiles[0];
    const result = await this.propertyService.validateCsv(cid, csvFile, currentuser);
    res.status(httpStatusCodes.OK).json(result);
  };

  createPropertiesFromCsv = async (req: Request, res: Response) => {
    const { cid } = req.params;
    const currentuser = req.currentuser!;
    if (!req.body.scannedFiles) {
      return res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: 'No CSV file uploaded',
      });
    }
    const csvFile: ExtractedMediaFile = req.body.scannedFiles[0];
    const result = await this.propertyService.addPropertiesFromCsv(
      cid,
      csvFile.path,
      currentuser.sub
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  getClientProperties = async (req: Request, res: Response) => {
    const { page, limit, sort, skip } = req.query;
    const { cid } = req.params;

    const paginationQuery: IPaginationQuery = {
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 10,
      sort: sort as string,
      skip: skip ? parseInt(skip as string, 10) : 5,
    };
    const data = await this.propertyService.getClientProperties(cid, paginationQuery);
    res.status(httpStatusCodes.OK).json(data);
  };

  getPropertyUnits = async (req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  getProperty = async (req: Request, res: Response) => {
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

  search = async (req: Request, res: Response) => {
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
