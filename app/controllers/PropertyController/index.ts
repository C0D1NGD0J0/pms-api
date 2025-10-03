import { Response } from 'express';
import { t } from '@shared/languages';
import { httpStatusCodes } from '@utils/index';
import { PropertyService } from '@services/index';
import { IUserRole } from '@shared/constants/roles.constants';
import propertyFormMeta from '@shared/constants/fromStaticData.json';
import { MediaUploadService } from '@services/mediaUpload/mediaUpload.service';
import { IPropertyFilterQuery, PropertyType } from '@interfaces/property.interface';
import { ExtractedMediaFile, ResourceContext, AppRequest } from '@interfaces/utils.interface';

interface IConstructor {
  mediaUploadService: MediaUploadService;
  propertyService: PropertyService;
}

export class PropertyController {
  propertyService: PropertyService;
  mediaUploadService: MediaUploadService;

  constructor({ propertyService, mediaUploadService }: IConstructor) {
    this.propertyService = propertyService;
    this.mediaUploadService = mediaUploadService;
  }

  create = async (req: AppRequest, res: Response) => {
    const newProperty = await this.propertyService.addProperty(req.context, req.body);

    const uploadResult = await this.mediaUploadService.handleFiles(req, {
      primaryResourceId: newProperty.data.id,
      uploadedBy: req.context.currentuser!.sub,
      resourceContext: ResourceContext.PROPERTY,
    });

    const response = uploadResult.hasFiles
      ? {
          ...newProperty,
          fileUpload: uploadResult.message,
          processedFiles: uploadResult.processedFiles,
        }
      : newProperty;

    res.status(httpStatusCodes.OK).json(response);
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
    const currentuser = req.context.currentuser;

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

    const data = await this.propertyService.getClientProperties(cuid, currentuser, queryParams);
    res.status(httpStatusCodes.OK).json(data);
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

    const hardDelete = req.query['hard-delete'] === 'true';
    const uploadResult = await this.mediaUploadService.handleFiles(req, {
      primaryResourceId: pid,
      uploadedBy: currentuser.sub,
      resourceContext: ResourceContext.PROPERTY,
      hardDelete,
    });

    const ctx = { cuid, pid, currentuser, hardDelete };
    const result = await this.propertyService.updateClientProperty(ctx, req.body);

    const response = uploadResult.hasFiles
      ? {
          ...result,
          fileUpload: uploadResult.message,
          processedFiles: uploadResult.processedFiles,
        }
      : result;

    res.status(httpStatusCodes.OK).json(response);
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

  deleteMediaFromProperty = async (req: AppRequest, res: Response) => {
    // const { cuid, pid } = req.params;
    const { currentuser } = req.context;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'User not authenticated',
      });
    }
    // TODO: implement archive restoration
    res.status(httpStatusCodes.OK).json({ success: true, message: 'Method not implemented yet' });
  };

  getPropertyFormMetadata = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: propertyFormMeta,
    });
  };

  getAssignableUsers = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const filters = {
      role: req.query.role as
        | IUserRole.ADMIN
        | IUserRole.STAFF
        | IUserRole.MANAGER
        | 'all'
        | undefined,
      department: req.query.department as string | undefined,
      search: req.query.search as string | undefined,
      page: req.query.page ? parseInt(req.query.page as string) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
    };
    const currentuser = req.context.currentuser!;
    const result = await this.propertyService.getAssignableUsers(cuid, currentuser, filters);
    res.status(httpStatusCodes.OK).json(result);
  };

  getPendingApprovals = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const { currentuser } = req.context;
    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    const pagination = {
      page: parseInt(req.query.page as string) || 1,
      limit: parseInt(req.query.limit as string) || 10,
      sort: req.query.sort as string,
      sortBy: req.query.sortBy as string,
    };

    const result = await this.propertyService.getPendingApprovals(cuid, currentuser, pagination);
    res.status(httpStatusCodes.OK).json(result);
  };

  approveProperty = async (req: AppRequest, res: Response) => {
    const { cuid, pid } = req.params;
    const { currentuser } = req.context;
    const { notes } = req.body;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    const result = await this.propertyService.approveProperty(cuid, pid, currentuser, notes);
    res.status(httpStatusCodes.OK).json(result);
  };

  rejectProperty = async (req: AppRequest, res: Response) => {
    const { cuid, pid } = req.params;
    const { currentuser } = req.context;
    const { reason } = req.body;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    const result = await this.propertyService.rejectProperty(cuid, pid, currentuser, reason);
    res.status(httpStatusCodes.OK).json(result);
  };

  bulkApproveProperties = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const { currentuser } = req.context;
    const { propertyIds } = req.body;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    const result = await this.propertyService.bulkApproveProperties(cuid, propertyIds, currentuser);
    res.status(httpStatusCodes.OK).json(result);
  };

  bulkRejectProperties = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const { currentuser } = req.context;
    const { propertyIds, reason } = req.body;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    const result = await this.propertyService.bulkRejectProperties(
      cuid,
      propertyIds,
      currentuser,
      reason
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  getMyPropertyRequests = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const { currentuser } = req.context;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    const filters = {
      approvalStatus: req.query.approvalStatus as 'pending' | 'approved' | 'rejected' | undefined,
      pagination: {
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 10,
        sort: req.query.sort as string,
        sortBy: req.query.sortBy as string,
      },
    };

    const result = await this.propertyService.getMyPropertyRequests(cuid, currentuser, filters);
    res.status(httpStatusCodes.OK).json(result);
  };
}
