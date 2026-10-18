import { Response } from 'express';
import { t } from '@shared/languages';
import { PropertyUnitService } from '@services/property';
import { MediaUploadService } from '@services/mediaUpload';
import { IPropertyFilterQuery } from '@interfaces/property.interface';
import { parseColumnMappingField, httpStatusCodes } from '@utils/index';
import { ExtractedMediaFile, AppRequest } from '@interfaces/utils.interface';

interface IConstructor {
  propertyUnitService: PropertyUnitService;
  mediaUploadService: MediaUploadService;
}

export class PropertyUnitController {
  private readonly propertyUnitService: PropertyUnitService;
  private readonly mediaUploadService: MediaUploadService;

  constructor({ propertyUnitService, mediaUploadService }: IConstructor) {
    this.propertyUnitService = propertyUnitService;
    this.mediaUploadService = mediaUploadService;
  }

  addUnit = async (req: AppRequest, res: Response) => {
    const unitData = req.body;
    const result = await this.propertyUnitService.addPropertyUnit(req.context, unitData);
    res.status(httpStatusCodes.OK).json(result);
  };

  getPropertyUnits = async (req: AppRequest, res: Response) => {
    const pagination = (req.query.pagination as any) || {};
    const filter = (req.query.filter as any) || {};

    const queryParams: IPropertyFilterQuery = {
      pagination: {
        page: pagination.page ? parseInt(pagination.page, 10) : 1,
        limit: pagination.limit ? parseInt(pagination.limit, 10) : 10,
        sortBy: pagination.sort as string,
        sort: pagination.order as string,
      },
      filters: filter,
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

  approveUnitChanges = async (req: AppRequest, res: Response) => {
    const result = await this.propertyUnitService.approveUnitChanges(req.context, req.body.notes);
    res.status(httpStatusCodes.OK).json(result);
  };

  rejectUnitChanges = async (req: AppRequest, res: Response) => {
    const result = await this.propertyUnitService.rejectUnitChanges(req.context, req.body.reason);
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
    const photos = await this.mediaUploadService.uploadRequestFiles(req, {
      resourceName: 'property-unit',
      resourceId: req.params.puid,
      fieldName: 'photos',
      actorId: req.context.currentuser!.sub,
    });
    if (photos.length === 0) {
      return res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: t('propertyUnit.errors.noDocumentFileUploaded'),
      });
    }
    const result = await this.propertyUnitService.addDocumentToUnit(req.context, photos);
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

  getCsvTemplate = async (_req: AppRequest, res: Response) => {
    const csv = this.propertyUnitService.getCsvTemplate();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="unit-import-template.csv"');
    res.status(httpStatusCodes.OK).send(csv);
  };

  getCsvImportFields = async (_req: AppRequest, res: Response) => {
    const data = this.propertyUnitService.getCsvImportFields();
    res.status(httpStatusCodes.OK).json({ success: true, data });
  };

  validateUnitsCsv = async (req: AppRequest, res: Response) => {
    if (!req.scannedFiles || !req.scannedFiles.length) {
      return res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: t('propertyUnit.errors.noCsvFileUploaded'),
      });
    }

    const csvFile: ExtractedMediaFile = req.scannedFiles[0];
    const result = await this.propertyUnitService.validateUnitsCsv(
      req.context,
      csvFile,
      parseColumnMappingField(req.body?.columnMapping)
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  importUnitsFromCsv = async (req: AppRequest, res: Response) => {
    if (!req.scannedFiles || !req.scannedFiles.length) {
      return res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: t('propertyUnit.errors.noCsvFileUploaded'),
      });
    }

    const csvFile: ExtractedMediaFile = req.scannedFiles[0];
    const result = await this.propertyUnitService.importUnitsFromCsv(
      req.context,
      csvFile,
      parseColumnMappingField(req.body?.columnMapping)
    );
    res.status(httpStatusCodes.OK).json(result);
  };
}
