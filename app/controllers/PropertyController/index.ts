import { Response } from 'express';
import { t } from '@shared/languages';
import { httpStatusCodes } from '@utils/index';
import { PropertyService } from '@services/index';
import propertyFormMeta from '@shared/constants/fromStaticData.json';
import { ExtractedMediaFile, AppRequest } from '@interfaces/utils.interface';
import { IPropertyFilterQuery, PropertyType } from '@interfaces/property.interface';

interface IConstructor {
  propertyService: PropertyService;
}

export class PropertyController {
  propertyService: PropertyService;
  constructor({ propertyService }: IConstructor) {
    this.propertyService = propertyService;
  }

  create = async (req: AppRequest, res: Response) => {
    const newProperty = await this.propertyService.addProperty(req.context, req.body);
    res.status(httpStatusCodes.OK).json({ success: true, data: newProperty });
  };

  validateCsv = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const { currentuser } = req.context;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    if (!req.body.scannedFiles) {
      return res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: t('property.errors.noCsvFileUploaded'),
      });
    }
    const csvFile: ExtractedMediaFile = req.body.scannedFiles[0];
    const result = await this.propertyService.validateCsv(cuid, csvFile, currentuser);
    res.status(httpStatusCodes.OK).json(result);
  };

  createPropertiesFromCsv = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const { currentuser } = req.context;
    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'User not authenticated',
      });
    }
    if (!req.body.scannedFiles) {
      return res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: t('property.errors.noCsvFileUploaded'),
      });
    }
    const csvFile: ExtractedMediaFile = req.body.scannedFiles[0];
    const result = await this.propertyService.addPropertiesFromCsv(
      cuid,
      csvFile.path,
      currentuser.sub
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  getClientProperties = async (req: AppRequest, res: Response) => {
    const { page, limit, sort, sortBy } = req.query;
    const { cuid } = req.params;

    const queryParams: IPropertyFilterQuery = {
      pagination: {
        page: parseInt(page as string) || 1,
        limit: parseInt(limit as string) || 10,
        sortBy: sortBy as string,
        sort: sort as string,
      },
      filters: {},
    };

    if (queryParams.filters) {
      if (req.query.propertyType) {
        queryParams.filters.propertyType = req.query.propertyType as PropertyType;
      }

      if (req.query.status) {
        queryParams.filters.status = req.query.status as any;
      }

      if (req.query.occupancyStatus) {
        queryParams.filters.occupancyStatus = req.query.occupancyStatus as any;
      }

      if (req.query.minPrice || req.query.maxPrice) {
        queryParams.filters.priceRange = {};

        if (req.query.minPrice) {
          queryParams.filters.priceRange.min = parseInt(req.query.minPrice as string);
        }

        if (req.query.maxPrice) {
          queryParams.filters.priceRange.max = parseInt(req.query.maxPrice as string);
        }
      }

      if (req.query.searchTerm) {
        queryParams.filters.searchTerm = req.query.searchTerm as string;
      }
    }
    const data = await this.propertyService.getClientProperties(cuid, queryParams);
    res.status(httpStatusCodes.OK).json(data);
  };

  getPropertyUnits = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  getProperty = async (req: AppRequest, res: Response) => {
    const { cuid, pid } = req.params;
    const { currentuser } = req.context;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    const data = await this.propertyService.getClientProperty(cuid, pid, currentuser);
    res.status(httpStatusCodes.OK).json(data);
  };

  updateClientProperty = async (req: AppRequest, res: Response) => {
    const { cuid, pid } = req.params;
    const { currentuser } = req.context;
    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'User not authenticated',
      });
    }
    const ctx = {
      cuid,
      pid,
      currentuser,
    };
    const result = await this.propertyService.updateClientProperty(ctx, req.body);

    res.status(httpStatusCodes.OK).json({ ...result });
  };

  archiveProperty = async (req: AppRequest, res: Response) => {
    const { cuid, pid } = req.params;
    const { currentuser } = req.context;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    const data = await this.propertyService.archiveClientProperty(cuid, pid, currentuser);
    res.status(httpStatusCodes.OK).json(data);
  };

  verifyOccupancyStatus = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  search = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  addMediaToProperty = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  deleteMediaFromProperty = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  checkAvailability = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  getNearbyProperties = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  restorArchivedProperty = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.OK).json({ success: true });
  };

  getPropertyFormMetadata = async (req: AppRequest, res: Response) => {
    // const formType = req.query.formType as 'propertyForm' | 'unitForm';
    // if (formType && !propertyFormMeta[formType]) {
    //   return res.status(httpStatusCodes.BAD_REQUEST).json({
    //     success: false,
    //     message: `Invalid form type: ${formType}`,
    //   });
    // }

    res.status(httpStatusCodes.OK).json({
      success: true,
      data: propertyFormMeta,
    });
  };

  getAssignableUsers = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const filters = {
      role: req.query.role as 'admin' | 'staff' | 'manager' | 'all' | undefined,
      department: req.query.department as string | undefined,
      search: req.query.search as string | undefined,
      page: req.query.page ? parseInt(req.query.page as string) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
    };

    const result = await this.propertyService.getAssignableUsers(cuid, filters);
    res.status(httpStatusCodes.OK).json(result);
  };
}
