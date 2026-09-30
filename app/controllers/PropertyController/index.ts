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
      primaryResourceId: newProperty.data.pid,
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

    if (!req.scannedFiles) {
      return res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: t('property.errors.noCsvFileUploaded'),
      });
    }
    const csvFile: ExtractedMediaFile = req.scannedFiles[0];
    const columnMapping = this.parseColumnMapping(req.body?.columnMapping);
    const result = await this.propertyService.validateCsv(
      cuid,
      csvFile,
      currentuser,
      columnMapping
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  getCsvTemplate = async (_req: AppRequest, res: Response) => {
    const csv = this.propertyService.getCsvTemplate();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="property-import-template.csv"');
    res.status(httpStatusCodes.OK).send(csv);
  };

  getCsvImportFields = async (req: AppRequest, res: Response) => {
    const platform = typeof req.query.platform === 'string' ? req.query.platform : undefined;
    const result = this.propertyService.getCsvImportFields(platform);
    res.status(httpStatusCodes.OK).json({ success: true, data: result });
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
    if (!req.scannedFiles) {
      return res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: t('property.errors.noCsvFileUploaded'),
      });
    }
    const csvFile: ExtractedMediaFile = req.scannedFiles[0];
    const columnMapping = this.parseColumnMapping(req.body?.columnMapping);
    const result = await this.propertyService.addPropertiesFromCsv(
      cuid,
      csvFile.path,
      currentuser.sub,
      columnMapping
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  getClientProperties = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const currentuser = req.context.currentuser;
    const pagination = (req.query.pagination as any) || {};
    const filter = (req.query.filter as any) || {};

    const queryParams: IPropertyFilterQuery = {
      pagination: {
        page: pagination.page ? parseInt(pagination.page, 10) : 1,
        limit: pagination.limit ? parseInt(pagination.limit, 10) : 10,
        sortBy: pagination.sortBy as string,
        sort: pagination.order as string,
      },
      filters: {},
    };

    if (queryParams.filters) {
      if (filter.propertyType) {
        queryParams.filters.propertyType = filter.propertyType as PropertyType;
      }

      if (filter.status) {
        queryParams.filters.operationalStatus = filter.status as any;
      }

      if (filter.occupancyStatus) {
        queryParams.filters.occupancyStatus = filter.occupancyStatus as any;
      }

      if (filter.minPrice || filter.maxPrice) {
        queryParams.filters.priceRange = {};

        if (filter.minPrice) {
          queryParams.filters.priceRange.min = parseInt(filter.minPrice, 10);
        }

        if (filter.maxPrice) {
          queryParams.filters.priceRange.max = parseInt(filter.maxPrice, 10);
        }
      }

      if (filter.searchTerm) {
        queryParams.filters.searchTerm = filter.searchTerm as string;
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

    // Parse include query parameter
    const includeParam = req.query.include as string | undefined;
    const include = includeParam ? includeParam.split(',').map((s) => s.trim()) : undefined;

    const data = await this.propertyService.getClientProperty(cuid, pid, currentuser, include);
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

    // Enrich document files with documentType from the form body
    if (req.scannedFiles && req.body?.documents) {
      const bodyDocs = Array.isArray(req.body.documents) ? req.body.documents : [];
      for (const file of req.scannedFiles) {
        const match = file.fieldName.match(/^documents\[(\d+)\]/);
        if (match) {
          const idx = parseInt(match[1], 10);
          if (bodyDocs[idx]?.documentType) {
            file.documentType = bodyDocs[idx].documentType;
          }
        }
      }
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

  batchArchiveProperties = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const { currentuser } = req.context;
    const { pids } = req.body;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    const data = await this.propertyService.batchArchiveProperties(cuid, pids, currentuser);
    res.status(httpStatusCodes.OK).json(data);
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
    const { cuid, pid } = req.params;
    const { documentId } = req.body;

    if (!documentId) {
      return res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: 'Document ID is required',
      });
    }

    const result = await this.propertyService.archivePropertyMedia(cuid, pid, documentId);
    res.status(httpStatusCodes.OK).json(result);
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

  assignStaff = async (req: AppRequest, res: Response) => {
    const { cuid, pid } = req.params;
    const { currentuser } = req.context;
    const result = await this.propertyService.assignStaff(
      { cuid, pid, currentuser },
      req.body.userId
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  unassignStaff = async (req: AppRequest, res: Response) => {
    const { cuid, pid } = req.params;
    const { currentuser } = req.context;
    const result = await this.propertyService.unassignStaff(
      { cuid, pid, currentuser },
      req.body.userId
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  getLeaseableProperties = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const { currentuser } = req.context;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    const fetchUnits = req.query.fetchUnits === 'true';

    const result = await this.propertyService.getLeaseableProperties(cuid, currentuser, fetchUnits);
    res.status(httpStatusCodes.OK).json(result);
  };

  // ── Verification endpoints ──────────────────────────────────────────

  getPendingVerifications = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const { currentuser } = req.context;
    if (!currentuser) {
      return res
        .status(httpStatusCodes.UNAUTHORIZED)
        .json({ success: false, message: 'User not authenticated' });
    }
    const { page = 1, limit = 10, sort = '-createdAt' } = req.query as any;
    const result = await this.propertyService.getPendingVerifications(cuid, currentuser, {
      page,
      limit,
      sort,
    });
    res.status(httpStatusCodes.OK).json(result);
  };

  verifyProperty = async (req: AppRequest, res: Response) => {
    const { cuid, pid } = req.params;
    const { currentuser } = req.context;
    if (!currentuser) {
      return res
        .status(httpStatusCodes.UNAUTHORIZED)
        .json({ success: false, message: 'User not authenticated' });
    }
    const result = await this.propertyService.verifyProperty(
      cuid,
      pid,
      currentuser,
      req.body.notes
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  rejectVerification = async (req: AppRequest, res: Response) => {
    const { cuid, pid } = req.params;
    const { currentuser } = req.context;
    if (!currentuser) {
      return res
        .status(httpStatusCodes.UNAUTHORIZED)
        .json({ success: false, message: 'User not authenticated' });
    }
    const result = await this.propertyService.rejectVerification(
      cuid,
      pid,
      currentuser,
      req.body.reason
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  grantVerificationGracePeriod = async (req: AppRequest, res: Response) => {
    const { cuid, pid } = req.params;
    const { currentuser } = req.context;
    if (!currentuser) {
      return res
        .status(httpStatusCodes.UNAUTHORIZED)
        .json({ success: false, message: 'User not authenticated' });
    }
    const { expiresAt, notes } = req.body;
    const result = await this.propertyService.grantVerificationGracePeriod(
      cuid,
      pid,
      currentuser,
      expiresAt,
      notes
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  /** columnMapping arrives as a JSON string form field alongside the CSV file. */
  private parseColumnMapping(raw: unknown): Record<string, string> | undefined {
    if (typeof raw !== 'string' || !raw.trim()) return undefined;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}
