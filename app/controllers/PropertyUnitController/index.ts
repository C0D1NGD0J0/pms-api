import { Response } from 'express';
import { t } from '@shared/languages';
import { httpStatusCodes } from '@utils/index';
import { PropertyUnitService } from '@services/property';
import { AppRequest } from '@interfaces/utils.interface';
import { IPropertyFilterQuery } from '@interfaces/property.interface';

interface IConstructor {
  propertyUnitService: PropertyUnitService;
}

export class PropertyUnitController {
  private readonly propertyUnitService: PropertyUnitService;

  constructor({ propertyUnitService }: IConstructor) {
    this.propertyUnitService = propertyUnitService;
  }

  addUnit = async (req: AppRequest, res: Response) => {
    const unitData = req.body;
    const result = await this.propertyUnitService.addPropertyUnit(req.context, unitData);
    res.status(httpStatusCodes.OK).json(result);
  };

  getPropertyUnits = async (req: AppRequest, res: Response) => {
    const { page, limit, sort, sortBy } = req.query;
    const queryParams: IPropertyFilterQuery = {
      pagination: {
        page: parseInt(page as string) || 1,
        limit: parseInt(limit as string) || 10,
        sortBy: sortBy as string,
        sort: sort as string,
      },
      filters: {},
    };

    const result = await this.propertyUnitService.getPropertyUnits(
      req.context,
      queryParams['pagination']
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  getPropertyUnit = async (req: AppRequest, res: Response) => {
    const result = await this.propertyUnitService.getPropertyUnit(req.context);
    res.status(httpStatusCodes.OK).json(result);
  };

  updateUnit = async (req: AppRequest, res: Response) => {
    const result = await this.propertyUnitService.updatePropertyUnit(req.context, req.body);
    res.status(httpStatusCodes.OK).json(result);
  };

  updateUnitStatus = async (req: AppRequest, res: Response) => {
    const result = await this.propertyUnitService.updateUnitStatus(req.context, req.body);
    res.status(httpStatusCodes.OK).json(result);
  };

  archiveUnit = async (req: AppRequest, res: Response) => {
    const result = await this.propertyUnitService.archiveUnit(req.context);
    res.status(httpStatusCodes.OK).json(result);
  };

  setupInpection = async (req: AppRequest, res: Response) => {
    const result = await this.propertyUnitService.setupInspection(req.context, req.body);
    res.status(httpStatusCodes.OK).json(result);
  };

  addDocumentToUnit = async (req: AppRequest, res: Response) => {
    if (!req.body.scannedFiles) {
      return res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: t('propertyUnit.errors.noDocumentFileUploaded'),
      });
    }
    const result = await this.propertyUnitService.addDocumentToUnit(
      req.context,
      req.body.scannedFiles
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  deleteDocumentFromUnit = async (req: AppRequest, res: Response) => {
    const result = await this.propertyUnitService.deleteDocumentFromUnit(req.context);
    res.status(httpStatusCodes.OK).json(result);
  };

  addInspection = async (req: AppRequest, res: Response) => {
    const result = await this.propertyUnitService.setupInspection(req.context, req.body);
    res.status(httpStatusCodes.OK).json(result);
  };

  getUnit = async (req: AppRequest, res: Response) => {
    const result = await this.propertyUnitService.getPropertyUnit(req.context);
    res.status(httpStatusCodes.OK).json(result);
  };
}
