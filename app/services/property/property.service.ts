import Logger from 'bunyan';
import { t } from '@shared/languages';
import sanitizeHtml from 'sanitize-html';
import { FilterQuery, Types } from 'mongoose';
import { PropertyCache } from '@caching/index';
import { GeoCoderService } from '@services/external';
import { PropertyCsvProcessor } from '@services/csv';
import { ICurrentUser } from '@interfaces/user.interface';
import { PropertyQueue, UploadQueue } from '@queues/index';
import { EventEmitterService } from '@services/eventEmitter';
import { PropertyTypeManager } from '@utils/PropertyTypeManager';
import { getRequestDuration, createLogger, JOB_NAME } from '@utils/index';
import { PropertyUnitDAO, PropertyDAO, ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import {
  UploadCompletedPayload,
  UploadFailedPayload,
  IDisposable,
  EventTypes,
} from '@interfaces/index';
import {
  ValidationRequestError,
  InvalidRequestError,
  BadRequestError,
  NotFoundError,
} from '@shared/customErrors';
import {
  ExtractedMediaFile,
  ISuccessReturnData,
  IPaginationQuery,
  IRequestContext,
  PaginateResult,
  UploadResult,
} from '@interfaces/utils.interface';
import {
  IAssignableUsersFilter,
  IPropertyWithUnitInfo,
  IPropertyFilterQuery,
  IPropertyDocument,
  IAssignableUser,
  NewPropertyType,
} from '@interfaces/property.interface';

import { PropertyValidationService } from './propertyValidation.service';

interface IConstructor {
  propertyCsvProcessor: PropertyCsvProcessor;
  emitterService: EventEmitterService;
  geoCoderService: GeoCoderService;
  propertyUnitDAO: PropertyUnitDAO;
  propertyCache: PropertyCache;
  propertyQueue: PropertyQueue;
  uploadQueue: UploadQueue;
  propertyDAO: PropertyDAO;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

export class PropertyService implements IDisposable {
  private readonly log: Logger;
  private uploadQueue: UploadQueue;
  private readonly clientDAO: ClientDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly propertyQueue: PropertyQueue;
  private readonly propertyCache: PropertyCache;
  private readonly geoCoderService: GeoCoderService;
  private readonly emitterService: EventEmitterService;
  private readonly propertyCsvProcessor: PropertyCsvProcessor;
  private readonly userDAO: UserDAO;

  constructor({
    clientDAO,
    profileDAO,
    propertyDAO,
    propertyUnitDAO,
    uploadQueue,
    propertyCache,
    emitterService,
    propertyQueue,
    geoCoderService,
    propertyCsvProcessor,
    userDAO,
  }: IConstructor) {
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.propertyDAO = propertyDAO;
    this.propertyUnitDAO = propertyUnitDAO;
    this.uploadQueue = uploadQueue;
    this.propertyQueue = propertyQueue;
    this.propertyCache = propertyCache;
    this.emitterService = emitterService;
    this.geoCoderService = geoCoderService;
    this.log = createLogger('PropertyService');
    this.propertyCsvProcessor = propertyCsvProcessor;
    this.userDAO = userDAO;

    // Initialize event listeners
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.emitterService.on(EventTypes.UPLOAD_COMPLETED, this.handleUploadCompleted.bind(this));
    this.emitterService.on(EventTypes.UPLOAD_FAILED, this.handleUploadFailed.bind(this));

    // Unit-related events for property occupancy sync
    this.emitterService.on(EventTypes.UNIT_CREATED, this.handleUnitChanged.bind(this));
    this.emitterService.on(EventTypes.UNIT_UPDATED, this.handleUnitChanged.bind(this));
    this.emitterService.on(EventTypes.UNIT_ARCHIVED, this.handleUnitChanged.bind(this));
    this.emitterService.on(EventTypes.UNIT_UNARCHIVED, this.handleUnitChanged.bind(this));
    this.emitterService.on(EventTypes.UNIT_STATUS_CHANGED, this.handleUnitChanged.bind(this));
    this.emitterService.on(EventTypes.UNIT_BATCH_CREATED, this.handleUnitBatchChanged.bind(this));

    this.log.info(t('property.logging.eventListenersInitialized'));
  }

  async addProperty(
    cxt: IRequestContext,
    propertyData: { scannedFiles?: ExtractedMediaFile[] } & NewPropertyType
  ): Promise<ISuccessReturnData> {
    const {
      params: { cuid },
    } = cxt.request;
    const currentuser = cxt.currentuser!;
    const start = process.hrtime.bigint();

    this.log.info(t('property.logging.startingCreation'));

    const validationResult = PropertyValidationService.validateProperty(propertyData);
    if (!validationResult.valid) {
      this.log.error(
        {
          cuid,
          url: cxt.request.url,
          userId: currentuser.sub,
          requestId: cxt.requestId,
          errors: validationResult.errors,
          propertyType: propertyData.propertyType,
          duration: getRequestDuration(start).durationInMs,
        },
        'Property validation failed'
      );

      const errorInfo: { [key: string]: string[] } = {};
      validationResult.errors.forEach((error) => {
        if (!errorInfo[error.field]) {
          errorInfo[error.field] = [];
        }
        errorInfo[error.field].push(error.message);
      });

      throw new ValidationRequestError({
        message: t('property.errors.validationFailed'),
        errorInfo,
      });
    }

    const session = await this.propertyDAO.startSession();
    const result = await this.propertyDAO.withTransaction(session, async (session) => {
      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        this.log.error(`Client with cuid ${cuid} not found`);
        throw new BadRequestError({ message: t('property.errors.unableToAdd') });
      }

      const fullAddress = propertyData.address.fullAddress;
      // address uniqueness check
      if (fullAddress && cuid) {
        const existingProperty = await this.propertyDAO.findPropertyByAddress(
          fullAddress,
          cuid.toString()
        );

        if (existingProperty) {
          throw new InvalidRequestError({
            message: t('property.errors.duplicateAddress'),
          });
        }
      }

      this.propertyTypeValidation(propertyData);

      propertyData.createdBy = new Types.ObjectId(currentuser.sub);
      propertyData.managedBy = propertyData.managedBy
        ? new Types.ObjectId(propertyData.managedBy)
        : new Types.ObjectId(currentuser.sub);

      const property = await this.propertyDAO.createProperty(
        {
          ...propertyData,
          cuid,
        },
        session
      );

      if (!property) {
        throw new BadRequestError({ message: t('property.errors.unableToCreate') });
      }

      this.log.info(
        {
          propertyId: property.id,
          propertyName: property.name,
          propertyType: property.propertyType,
        },
        'Property created successfully'
      );

      return { property };
    });

    if (propertyData.scannedFiles && propertyData.scannedFiles.length > 0) {
      this.uploadQueue.addToUploadQueue(JOB_NAME.MEDIA_UPLOAD_JOB, {
        resource: {
          fieldName: 'documents',
          resourceType: 'unknown',
          resourceName: 'property',
          actorId: currentuser.sub,
          resourceId: result.property.id,
        },
        files: propertyData.scannedFiles,
      });
    }

    await this.propertyCache.cacheProperty(cuid, result.property.id, result.property);
    return { success: true, data: result.property, message: t('property.success.created') };
  }

  private propertyTypeValidation(propertyData: NewPropertyType): void {
    const { propertyType, maxAllowedUnits = 1, specifications, fees } = propertyData;

    if (!propertyType) return;

    const rules = PropertyTypeManager.getRules(propertyType);
    const errors: string[] = [];

    if (rules.isMultiUnit) {
      if (maxAllowedUnits < rules.minUnits) {
        errors.push(`${propertyType} properties require at least ${rules.minUnits} units`);
      }

      // For multi-unit properties, bedrooms/bathrooms should be managed at unit level
      if (specifications?.bedrooms && specifications.bedrooms > 0) {
        this.log.warn(
          {
            propertyType,
            bedrooms: specifications.bedrooms,
          },
          `${propertyType} property has bedrooms defined at property level`
        );
      }
    }

    if (propertyType === 'commercial') {
      if (specifications?.bedrooms && specifications.bedrooms > 0) {
        errors.push('Commercial properties should not have bedrooms defined at property level');
      }

      if (!specifications?.totalArea || specifications.totalArea < 200) {
        errors.push('Commercial properties must have at least 200 sq ft of total area');
      }
    }

    if (propertyType === 'industrial') {
      if (!specifications?.lotSize) {
        errors.push('Industrial properties must specify lot size');
      }

      if (!specifications?.totalArea || specifications.totalArea < 1000) {
        errors.push('Industrial properties must have at least 1000 sq ft of total area');
      }
    }

    if (propertyData.occupancyStatus === 'occupied') {
      const rentalAmount =
        typeof fees?.rentalAmount === 'string' ? parseFloat(fees.rentalAmount) : fees?.rentalAmount;

      if (!rentalAmount || rentalAmount <= 0) {
        errors.push('Occupied properties must have a valid rental amount');
      }
    }

    if (errors.length > 0) {
      throw new ValidationRequestError({
        message: t('property.errors.businessRuleValidationFailed'),
        errorInfo: { propertyType: errors },
      });
    }
  }

  async addPropertiesFromCsv(
    cuid: string,
    csvFilePath: string,
    actorId: string
  ): Promise<ISuccessReturnData> {
    if (!csvFilePath || !cuid) {
      throw new BadRequestError({ message: t('property.errors.noCsvFile') });
    }
    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client) {
      this.log.error(`Client with cuid ${cuid} not found`);
      throw new BadRequestError({ message: 'Unable to add property to this account.' });
    }

    const jobData = {
      csvFilePath,
      userId: actorId,
      clientInfo: { cuid, displayName: client.displayName, id: client.id },
    };

    const job = await this.propertyQueue.addCsvImportJob(jobData);
    return {
      success: true,
      data: { processId: job.id },
      message: t('property.success.csvImportStarted'),
    };
  }

  async updatePropertyDocuments(
    propertyId: string,
    uploadResult: UploadResult[],
    userid: string
  ): Promise<ISuccessReturnData> {
    if (!propertyId) {
      throw new BadRequestError({ message: t('property.errors.propertyIdRequired') });
    }

    if (!uploadResult || uploadResult.length === 0) {
      throw new BadRequestError({ message: t('property.errors.uploadResultRequired') });
    }
    const property = await this.propertyDAO.findById(propertyId);
    if (!property) {
      throw new BadRequestError({ message: t('property.errors.unableToFind') });
    }

    const updatedProperty = await this.propertyDAO.updatePropertyDocument(
      propertyId,
      uploadResult,
      userid
    );

    if (!updatedProperty) {
      throw new BadRequestError({ message: 'Unable to update property.' });
    }

    return { success: true, data: updatedProperty, message: 'Property updated successfully' };
  }

  async validateCsv(
    cuid: string,
    csvFile: ExtractedMediaFile,
    currentUser: ICurrentUser
  ): Promise<ISuccessReturnData> {
    if (!csvFile) {
      throw new BadRequestError({ message: t('property.errors.noCsvUploaded') });
    }

    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client) {
      this.log.error(`Client with cuid ${cuid} not found`);
      throw new BadRequestError({ message: t('property.errors.unableToValidateCsv') });
    }

    if (csvFile.fileSize > 10 * 1024 * 1024) {
      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFile.path]);
      throw new BadRequestError({ message: t('property.errors.fileTooLarge') });
    }

    const jobData = {
      userId: currentUser.sub,
      csvFilePath: csvFile.path,
      clientInfo: { cuid, displayName: client.displayName, id: client.id },
    };
    const job = await this.propertyQueue.addCsvValidationJob(jobData);
    return {
      success: true,
      data: { processId: job.id },
      message: t('property.success.csvValidationStarted'),
    };
  }

  async getClientProperties(
    cuid: string,
    queryParams: IPropertyFilterQuery
  ): Promise<
    ISuccessReturnData<{
      items: IPropertyDocument[];
      pagination: PaginateResult | undefined;
    }>
  > {
    if (!cuid) {
      throw new BadRequestError({ message: t('property.errors.clientIdRequired') });
    }

    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client) {
      this.log.error(`Client with cuid ${cuid} not found`);
      throw new BadRequestError({ message: 'Unable to get properties for this account.' });
    }

    const { pagination, filters } = queryParams;
    const filter: FilterQuery<IPropertyDocument> = {
      cuid,
      deletedAt: null,
    };

    if (filters) {
      if (filters.propertyType) {
        filter.propertyType = { $in: filters.propertyType };
      }

      if (filters.status) {
        filter.status = { $in: filters.status };
      }

      if (filters.occupancyStatus) {
        filter.occupancyStatus = filters.occupancyStatus;
      }

      if (filters.priceRange) {
        const priceFilter: any = {};
        if (typeof filters.priceRange.min === 'number') {
          priceFilter.$gte = filters.priceRange.min;
        }
        if (typeof filters.priceRange.max === 'number') {
          priceFilter.$lte = filters.priceRange.max;
        }
        if (Object.keys(priceFilter).length > 0) {
          filter['financialDetails.marketValue'] = priceFilter;
        }
      }

      if (filters.areaRange) {
        const areaFilter: any = {};
        if (typeof filters.areaRange.min === 'number') {
          areaFilter.$gte = filters.areaRange.min;
        }
        if (typeof filters.areaRange.max === 'number') {
          areaFilter.$lte = filters.areaRange.max;
        }
        if (Object.keys(areaFilter).length > 0) {
          filter['specifications.totalArea'] = areaFilter;
        }
      }

      if (filters.location) {
        if (filters.location.city) {
          filter['address.city'] = { $regex: new RegExp(filters.location.city, 'i') };
        }
        if (filters.location.state) {
          filter['address.state'] = { $regex: new RegExp(filters.location.state, 'i') };
        }
        if (filters.location.postCode) {
          filter['address.postCode'] = filters.location.postCode;
        }
      }

      if (filters.dateRange && filters.dateRange.field) {
        const dateFilter: any = {};
        if (filters.dateRange.start) {
          const startDate =
            typeof filters.dateRange.start === 'string'
              ? new Date(filters.dateRange.start)
              : filters.dateRange.start;
          dateFilter.$gte = startDate;
        }
        if (filters.dateRange.end) {
          const endDate =
            typeof filters.dateRange.end === 'string'
              ? new Date(filters.dateRange.end)
              : filters.dateRange.end;
          dateFilter.$lte = endDate;
        }
        if (Object.keys(dateFilter).length > 0) {
          filter[filters.dateRange.field] = dateFilter;
        }
      }

      if (filters.searchTerm && filters.searchTerm.trim()) {
        const searchRegex = new RegExp(filters.searchTerm.trim(), 'i');
        filter.$or = [
          { name: searchRegex },
          { 'address.city': searchRegex },
          { 'address.state': searchRegex },
          { 'address.postCode': searchRegex },
          { 'address.fullAddress': searchRegex },
        ];
      }
    }

    const opts: IPaginationQuery = {
      page: pagination.page,
      sort: pagination.sort,
      sortBy: pagination.sortBy,
      limit: Math.max(1, Math.min(pagination.limit || 10, 100)),
      skip: ((pagination.page || 1) - 1) * (pagination.limit || 10),
    };
    const cachedResult = await this.propertyCache.getClientProperties(cuid, opts);
    if (cachedResult.success && cachedResult.data) {
      return {
        success: true,
        data: {
          items: cachedResult.data.properties,
          pagination: cachedResult.data.pagination,
        },
      };
    }
    const properties = await this.propertyDAO.getPropertiesByClientId(cuid, filter, opts);
    await this.propertyCache.saveClientProperties(cuid, properties.items, {
      filter,
      pagination: opts,
    });

    return {
      success: true,
      data: {
        items: properties.items,
        pagination: properties.pagination,
      },
    };
  }

  async getClientProperty(
    cuid: string,
    pid: string,
    _currentUser: ICurrentUser
  ): Promise<ISuccessReturnData<IPropertyWithUnitInfo>> {
    if (!cuid || !pid) {
      throw new BadRequestError({ message: t('property.errors.clientAndPropertyIdRequired') });
    }

    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client) {
      this.log.error(`Client with cuid ${cuid} not found`);
      throw new BadRequestError({ message: 'Unable to get properties for this account.' });
    }

    const property = await this.propertyDAO.findFirst({
      pid,
      cuid,
      deletedAt: null,
    });
    if (!property) {
      throw new NotFoundError({ message: t('property.errors.notFound') });
    }
    const unitInfo = await this.getUnitInfoForProperty(property);

    return {
      success: true,
      data: {
        ...property.toJSON(),
        unitInfo,
      },
    };
  }

  async updateClientProperty(
    ctx: {
      cuid: string;
      pid: string;
      currentuser: ICurrentUser;
    },
    updateData: Partial<IPropertyDocument>
  ): Promise<ISuccessReturnData> {
    const { cuid, pid } = ctx;

    if (!cuid || !pid) {
      this.log.error('Client ID and Property ID are required');
      throw new BadRequestError({ message: t('property.errors.clientAndPropertyIdRequired') });
    }

    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client) {
      this.log.error(`Client with cuid ${cuid} not found`);
      throw new InvalidRequestError({ message: t('property.errors.clientNotFound') });
    }

    const property = await this.propertyDAO.findFirst({
      pid,
      cuid,
      deletedAt: null,
    });
    if (!property) {
      throw new NotFoundError({ message: t('property.errors.notFound') });
    }

    if (
      updateData.propertyType ||
      updateData.specifications ||
      updateData.financialDetails ||
      updateData.fees
    ) {
      const dataToValidate = {
        ...property,
        ...updateData,
        fullAddress: property.address?.fullAddress || 'existing-address',
      } as NewPropertyType;

      const validationResult = PropertyValidationService.validateProperty(dataToValidate, true);
      if (!validationResult.valid) {
        const errorInfo: { [key: string]: string[] } = {};
        validationResult.errors.forEach((error) => {
          if (!errorInfo[error.field]) {
            errorInfo[error.field] = [];
          }
          errorInfo[error.field].push(error.message);
        });

        throw new ValidationRequestError({
          message: t('property.errors.updateValidationFailed'),
          errorInfo,
        });
      }
    }

    if (property.description?.text !== updateData.description?.text) {
      updateData.description = {
        text: sanitizeHtml(updateData.description?.text || ''),
        html: sanitizeHtml(updateData.description?.html || ''),
      };
    }

    updateData.lastModifiedBy = new Types.ObjectId(ctx.currentuser.sub);
    if (updateData.financialDetails) {
      if (updateData.financialDetails.purchaseDate) {
        updateData.financialDetails.purchaseDate = new Date(
          updateData.financialDetails.purchaseDate
        );
      }

      if (updateData.financialDetails.lastAssessmentDate) {
        updateData.financialDetails.lastAssessmentDate = new Date(
          updateData.financialDetails.lastAssessmentDate
        );
      }
    }

    if (updateData.occupancyStatus) {
      this.validateOccupancyStatusChange(property, updateData);
    }

    const updatedProperty = await this.propertyDAO.update(
      {
        cuid,
        pid,
        deletedAt: null,
      },
      {
        $set: updateData,
      }
    );

    if (!updatedProperty) {
      throw new BadRequestError({ message: 'Unable to update property.' });
    }

    await this.propertyCache.invalidateProperty(cuid, property.id);
    return { success: true, data: updatedProperty, message: 'Property updated successfully' };
  }

  private validateOccupancyStatusChange(
    existingProperty: IPropertyDocument,
    updateData: Partial<IPropertyDocument>
  ): void {
    const errors: string[] = [];

    if (
      updateData.occupancyStatus === 'occupied' &&
      existingProperty.occupancyStatus !== 'occupied'
    ) {
      // Check if rental amount is set
      const hasRentalAmount = existingProperty.fees?.rentalAmount || updateData.fees?.rentalAmount;
      if (!hasRentalAmount) {
        errors.push('Occupied properties must have a rental amount');
      }
    }

    if (updateData.occupancyStatus === 'partially_occupied') {
      const maxAllowedUnits = updateData.maxAllowedUnits || existingProperty.maxAllowedUnits || 1;
      if (maxAllowedUnits <= 1) {
        errors.push('Single-unit properties cannot be partially occupied');
      }
    }

    if (errors.length > 0) {
      throw new ValidationRequestError({
        message: t('property.errors.occupancyValidationFailed'),
        errorInfo: { occupancyStatus: errors },
      });
    }
  }

  async archiveClientProperty(
    cuid: string,
    pid: string,
    currentUser: ICurrentUser
  ): Promise<ISuccessReturnData> {
    if (!cuid || !pid) {
      this.log.error('Client ID and Property ID are required');
      throw new BadRequestError({ message: t('property.errors.clientAndPropertyIdRequired') });
    }

    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client) {
      this.log.error(`Client with cuid ${cuid} not found`);
      throw new BadRequestError({ message: t('property.errors.unableToArchive') });
    }

    const property = await this.propertyDAO.findFirst({
      pid,
      cuid,
      deletedAt: null,
    });
    if (!property) {
      throw new NotFoundError({ message: t('property.errors.notFound') });
    }

    const archivedProperty = await this.propertyDAO.archiveProperty(property.id, currentUser.sub);

    if (!archivedProperty) {
      throw new BadRequestError({ message: t('property.errors.unableToArchive') });
    }

    await this.propertyCache.invalidateProperty(cuid, property.id);
    await this.propertyCache.invalidatePropertyLists(cuid);

    return { success: true, data: null, message: t('property.success.archived') };
  }

  async markDocumentsAsFailed(propertyId: string, errorMessage: string): Promise<void> {
    try {
      const property = await this.propertyDAO.findById(propertyId);
      if (!property || !property.documents) return;

      const updateOperations: any = {};
      const now = new Date();

      property.documents.forEach((doc, index) => {
        const isPending = doc.status === 'pending';

        if (isPending) {
          updateOperations[`documents.${index}.status`] = 'failed';
          updateOperations[`documents.${index}.errorMessage`] = errorMessage;
          updateOperations[`documents.${index}.processingCompleted`] = now;
        }
      });

      if (Object.keys(updateOperations).length > 0) {
        await this.propertyDAO.update(
          { _id: new Types.ObjectId(propertyId) },
          { $set: updateOperations }
        );

        this.log.warn(`Marked documents as failed for property ${propertyId}`, { errorMessage });
      }
    } catch (error) {
      this.log.error(`Error marking documents as failed for property ${propertyId}:`, error);
    }
  }

  private async handleUploadCompleted(payload: UploadCompletedPayload): Promise<void> {
    const { results, resourceName, resourceId, actorId } = payload;

    if (resourceName !== 'property') {
      this.log.debug(t('property.logging.ignoringUploadEvent'), {
        resourceName,
      });
      return;
    }

    try {
      await this.updatePropertyDocuments(resourceId, results, actorId);

      this.log.info(
        {
          propertyId: resourceId,
        },
        'Successfully processed upload completed event'
      );
    } catch (error) {
      this.log.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          propertyId: resourceId,
        },
        'Error processing upload completed event'
      );

      try {
        await this.markDocumentsAsFailed(
          resourceId,
          `Failed to process completed upload: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      } catch (markFailedError) {
        this.log.error(
          {
            error:
              markFailedError instanceof Error
                ? markFailedError.message
                : t('property.errors.unknownError'),
            propertyId: resourceId,
          },
          'Failed to mark documents as failed after upload processing error'
        );
      }
    }
  }

  private async handleUploadFailed(payload: UploadFailedPayload): Promise<void> {
    const { error, resourceType, resourceId } = payload;

    this.log.info(t('property.logging.receivedUploadFailedEvent'), {
      resourceType,
      resourceId,
      error: error.message,
    });

    try {
      await this.markDocumentsAsFailed(resourceId, error.message);

      this.log.info(t('property.logging.processedUploadFailedEvent'), {
        propertyId: resourceId,
      });
    } catch (markFailedError) {
      this.log.error(t('property.logging.errorProcessingUploadFailed'), {
        error:
          markFailedError instanceof Error
            ? markFailedError.message
            : t('property.errors.unknownError'),
        propertyId: resourceId,
      });
    }
  }

  private async handleUnitChanged(payload: any): Promise<void> {
    try {
      this.log.info(
        {
          propertyId: payload.propertyId,
          propertyPid: payload.propertyPid,
          cuid: payload.cuid,
          changeType: payload.changeType,
          unitId: payload.unitId,
        },
        'Processing unit change event for property occupancy sync'
      );

      // Sync property occupancy status based on current unit data
      await this.propertyDAO.syncPropertyOccupancyWithUnitsEnhanced(
        payload.propertyId,
        payload.userId
      );

      // Invalidate property cache to ensure fresh data on next request
      await this.propertyCache.invalidateProperty(payload.cuid, payload.propertyPid);
      await this.propertyCache.invalidatePropertyLists(payload.cuid);

      this.log.info(
        {
          propertyId: payload.propertyId,
          propertyPid: payload.propertyPid,
          changeType: payload.changeType,
        },
        'Successfully synced property occupancy after unit change'
      );
    } catch (error) {
      this.log.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          propertyId: payload.propertyId,
          propertyPid: payload.propertyPid,
          changeType: payload.changeType,
        },
        'Failed to sync property occupancy after unit change'
      );
    }
  }

  private async handleUnitBatchChanged(payload: any): Promise<void> {
    try {
      this.log.info(
        {
          propertyId: payload.propertyId,
          propertyPid: payload.propertyPid,
          cuid: payload.cuid,
          unitsCreated: payload.unitsCreated,
          unitsFailed: payload.unitsFailed,
        },
        'Processing unit batch change event for property occupancy sync'
      );

      // Only sync if at least one unit was created successfully
      if (payload.unitsCreated > 0) {
        await this.propertyDAO.syncPropertyOccupancyWithUnitsEnhanced(
          payload.propertyId,
          payload.userId
        );
        await this.propertyCache.invalidateProperty(payload.cuid, payload.propertyPid);
        await this.propertyCache.invalidatePropertyLists(payload.cuid);

        this.log.info(
          {
            propertyId: payload.propertyId,
            propertyPid: payload.propertyPid,
            unitsCreated: payload.unitsCreated,
          },
          'Successfully synced property occupancy after batch unit creation'
        );
      } else {
        this.log.info(
          {
            propertyId: payload.propertyId,
            propertyPid: payload.propertyPid,
            unitsFailed: payload.unitsFailed,
          },
          'Skipping property occupancy sync - no units were created successfully'
        );
      }
    } catch (error) {
      this.log.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          propertyId: payload.propertyId,
          propertyPid: payload.propertyPid,
          unitsCreated: payload.unitsCreated,
        },
        'Failed to sync property occupancy after batch unit creation'
      );
    }
  }

  async getUnitInfoForProperty(property: IPropertyDocument): Promise<{
    canAddUnit: boolean;
    maxAllowedUnits: number;
    currentUnits: number;
    availableSpaces: number;
    lastUnitNumber?: string;
    suggestedNextUnitNumber?: string;
    unitStats: {
      occupied: number;
      vacant: number;
      maintenance: number;
      available: number;
      reserved: number;
      inactive: number;
    };
  }> {
    const isMultiUnit = PropertyTypeManager.supportsMultipleUnits(property.propertyType);
    const maxAllowedUnits = property.maxAllowedUnits || 1;

    if (isMultiUnit) {
      const unitData = await this.propertyUnitDAO.getPropertyUnitInfo(property.id);
      const canAddUnitResult = await this.propertyDAO.canAddUnitToProperty(property.id);
      const availableSpaces = Math.max(0, maxAllowedUnits - unitData.currentUnits);

      let lastUnitNumber: string | undefined;
      let suggestedNextUnitNumber: string | undefined;

      if (unitData.currentUnits > 0) {
        try {
          const existingUnitNumbers = await this.propertyUnitDAO.getExistingUnitNumbers(
            property.id
          );

          if (existingUnitNumbers.length > 0) {
            // Find the highest numerical unit number
            const numericUnits = existingUnitNumbers
              .map((num) => {
                const match = num.match(/(\d+)/);
                return match ? parseInt(match[1], 10) : 0;
              })
              .filter((num) => num > 0);

            if (numericUnits.length > 0) {
              const highestNumber = Math.max(...numericUnits);
              lastUnitNumber = highestNumber.toString();

              // get suggested next unit number
              suggestedNextUnitNumber = await this.propertyUnitDAO.getNextAvailableUnitNumber(
                property.id,
                'sequential'
              );
            } else {
              // No numeric patterns found, get the last unit alphabetically
              lastUnitNumber = existingUnitNumbers.sort().pop();
              suggestedNextUnitNumber = await this.propertyUnitDAO.getNextAvailableUnitNumber(
                property.id,
                'custom'
              );
            }
          }
        } catch (error) {
          this.log.warn(`Error getting unit numbers for property ${property.id}:`, error);
          // continue without unit numbering info
        }
      } else {
        suggestedNextUnitNumber = this.propertyUnitDAO.getSuggestedStartingUnitNumber(
          property.propertyType
        );
      }

      return {
        canAddUnit: canAddUnitResult.canAdd,
        maxAllowedUnits,
        currentUnits: unitData.currentUnits,
        availableSpaces,
        lastUnitNumber,
        suggestedNextUnitNumber,
        unitStats: unitData.unitStats,
      };
    } else {
      // Single-unit property: derive stats from property status
      const unitStats = {
        occupied: 0,
        vacant: 0,
        maintenance: 0,
        available: 0,
        reserved: 0,
        inactive: 0,
      };

      // map property occupancy status to unit stats
      switch (property.occupancyStatus) {
        case 'partially_occupied':
          unitStats.occupied = 1;
          break;
        case 'occupied':
          unitStats.occupied = 1;
          break;
        case 'vacant':
          unitStats.available = 1;
          break;
        default:
          unitStats.available = 1;
          break;
      }

      // For single-unit properties, suggest unit numbers if they want to convert to multi-unit
      const suggestedNextUnitNumber =
        property.propertyType === 'house' || property.propertyType === 'townhouse'
          ? '2' // If converting house to duplex, start with unit 2
          : this.propertyUnitDAO.getSuggestedStartingUnitNumber(property.propertyType);

      return {
        canAddUnit: false,
        maxAllowedUnits: 1,
        currentUnits: 1,
        availableSpaces: 0,
        suggestedNextUnitNumber,
        unitStats,
      };
    }
  }

  /**
   * Get users that can be assigned to manage properties
   * Filters for admin, staff, and manager roles only, with optional department filtering
   */
  async getAssignableUsers(
    cuid: string,
    currentuser: ICurrentUser,
    filters: IAssignableUsersFilter
  ): Promise<ISuccessReturnData<{ items: IAssignableUser[]; pagination?: PaginateResult }>> {
    try {
      this.log.info('Fetching assignable users for client', { cuid, filters });

      // Validate client exists
      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        throw new NotFoundError({ message: t('client.errors.notFound') });
      }

      // Define management roles only (exclude vendor, tenant)
      const managementRoles = ['admin', 'staff', 'manager'];
      const roleFilter = filters.role && filters.role !== 'all' ? [filters.role] : managementRoles;

      // Build aggregation pipeline to get users with profile data
      const pipeline: any[] = [
        {
          $match: {
            'cuids.cuid': cuid,
            'cuids.isConnected': true,
            'cuids.roles': { $in: roleFilter },
            deletedAt: null,
          },
        },
        {
          $lookup: {
            from: 'profiles',
            localField: '_id',
            foreignField: 'user',
            as: 'profile',
          },
        },
        {
          $unwind: {
            path: '$profile',
            preserveNullAndEmptyArrays: true,
          },
        },
      ];

      // Add department filter if specified
      if (filters.department) {
        pipeline.push({
          $match: {
            'profile.employeeInfo.department': filters.department,
          },
        });
      }

      // Add search filter if specified
      if (filters.search) {
        pipeline.push({
          $match: {
            $or: [
              { email: { $regex: filters.search, $options: 'i' } },
              { 'profile.personalInfo.displayName': { $regex: filters.search, $options: 'i' } },
              { 'profile.personalInfo.firstName': { $regex: filters.search, $options: 'i' } },
              { 'profile.personalInfo.lastName': { $regex: filters.search, $options: 'i' } },
            ],
          },
        });
      }

      // Add projection to shape the response
      pipeline.push({
        $project: {
          // id: { $toString: '$_id' },
          puid: '$profile.puid',
          email: 1,
          displayName: '$profile.personalInfo.displayName',
          role: {
            $arrayElemAt: [
              {
                $filter: {
                  input: '$cuids',
                  cond: { $eq: ['$$this.cuid', cuid] },
                },
              },
              0,
            ],
          },
          employeeInfo: {
            jobTitle: '$profile.employeeInfo.jobTitle',
            employeeId: '$profile.employeeInfo.employeeId',
            department: '$profile.employeeInfo.department',
          },
        },
      });

      // Extract role from the cuid array
      pipeline.push({
        $addFields: {
          role: { $arrayElemAt: ['$role.roles', 0] },
          department: '$employeeInfo.department',
        },
      });

      // Execute aggregation with pagination
      const page = filters.page || 1;
      const limit = filters.limit || 10;
      const skip = (page - 1) * limit;

      // Add pagination
      const paginationPipeline = [...pipeline, { $skip: skip }, { $limit: limit }];

      // Execute both count and data queries
      const [users, totalCountResult] = await Promise.all([
        this.userDAO.aggregate(paginationPipeline),
        this.userDAO.aggregate([...pipeline, { $count: 'total' }]),
      ]);

      const total = (totalCountResult[0] as any)?.total || 0;
      const totalPages = Math.ceil(total / limit);

      const result = {
        items: users as unknown as IAssignableUser[],
        pagination: {
          total,
          page,
          pages: totalPages,
          limit,
          hasMoreResource: page < totalPages,
          perPage: limit,
          totalPages,
          currentPage: page,
        },
      };

      this.log.info('Successfully retrieved assignable users', {
        cuid,
        count: users.length,
        total,
      });

      return {
        success: true,
        data: result,
        message: t('property.success.assignableUsersRetrieved'),
      };
    } catch (error) {
      this.log.error('Failed to get assignable users', {
        cuid,
        filters,
        error: error.message,
      });
      throw error;
    }
  }

  async destroy(): Promise<void> {
    this.log.info(t('property.logging.cleaningUp'));

    // Remove all event listeners
    this.emitterService.off(EventTypes.UPLOAD_COMPLETED, this.handleUploadCompleted);
    this.emitterService.off(EventTypes.UPLOAD_FAILED, this.handleUploadFailed);
    this.emitterService.off(EventTypes.UNIT_CREATED, this.handleUnitChanged);
    this.emitterService.off(EventTypes.UNIT_UPDATED, this.handleUnitChanged);
    this.emitterService.off(EventTypes.UNIT_ARCHIVED, this.handleUnitChanged);
    this.emitterService.off(EventTypes.UNIT_UNARCHIVED, this.handleUnitChanged);
    this.emitterService.off(EventTypes.UNIT_STATUS_CHANGED, this.handleUnitChanged);
    this.emitterService.off(EventTypes.UNIT_BATCH_CREATED, this.handleUnitBatchChanged);

    this.log.info(t('property.logging.eventListenersRemoved'));
  }
}
