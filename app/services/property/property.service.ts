import Logger from 'bunyan';
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
import { PropertyUnitDAO, PropertyDAO, ProfileDAO, ClientDAO } from '@dao/index';
import { UploadCompletedPayload, UploadFailedPayload, EventTypes } from '@interfaces/index';
import {
  IPropertyFilterQuery,
  IPropertyDocument,
  NewPropertyType,
} from '@interfaces/property.interface';
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
}

export class PropertyService {
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

    // Initialize event listeners
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.emitterService.on(EventTypes.UPLOAD_COMPLETED, this.handleUploadCompleted.bind(this));
    this.emitterService.on(EventTypes.UPLOAD_FAILED, this.handleUploadFailed.bind(this));
    this.log.info('PropertyService event listeners initialized');
  }

  /**
   * Get unit information for a property, handling single-unit vs multi-unit logic
   */
  private async getUnitInfoForProperty(property: IPropertyDocument): Promise<{
    canAddUnit: boolean;
    totalUnits: number;
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
    const totalUnits = property.totalUnits || 1;

    if (isMultiUnit) {
      // Multi-unit property: use PropertyUnit records
      const unitData = await this.propertyUnitDAO.getPropertyUnitInfo(property.id);
      const canAddUnitResult = await this.propertyDAO.canAddUnitToProperty(property.id);
      const availableSpaces = Math.max(0, totalUnits - unitData.currentUnits);

      // Get existing unit numbers and determine the last/highest one
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

              // Get suggested next unit number using PropertyUnitDAO logic
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
          // Continue without unit numbering info
        }
      } else {
        // No existing units, suggest starting numbers based on property type
        suggestedNextUnitNumber = this.getSuggestedStartingUnitNumber(property.propertyType);
      }

      return {
        canAddUnit: canAddUnitResult.canAdd,
        totalUnits,
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

      // Map property occupancy status to unit stats
      switch (property.occupancyStatus) {
        case 'occupied':
          unitStats.occupied = 1;
          break;
        case 'vacant':
          unitStats.available = 1;
          break;
        case 'partially_occupied':
          // For single-unit properties, partially occupied doesn't make sense,
          // but treat it as occupied
          unitStats.occupied = 1;
          break;
        default:
          // Default to available for unknown status
          unitStats.available = 1;
          break;
      }

      // For single-unit properties, suggest unit numbers if they want to convert to multi-unit
      const suggestedNextUnitNumber =
        property.propertyType === 'house' || property.propertyType === 'townhouse'
          ? '2' // If converting house to duplex, start with unit 2
          : this.getSuggestedStartingUnitNumber(property.propertyType);

      return {
        canAddUnit: false, // Single-unit properties typically can't add more units
        totalUnits: 1,
        currentUnits: 1, // Single-unit property always has 1 unit (itself)
        availableSpaces: 0, // No space to add more units
        lastUnitNumber: '1', // The property itself can be considered unit 1
        suggestedNextUnitNumber,
        unitStats,
      };
    }
  }

  /**
   * Get suggested starting unit number based on property type
   */
  private getSuggestedStartingUnitNumber(propertyType: string): string {
    switch (propertyType) {
      case 'apartment':
      case 'condominium':
        return '101'; // Floor-based numbering
      case 'commercial':
      case 'industrial':
        return 'A-1001'; // Letter prefix pattern
      case 'house':
      case 'townhouse':
        return '1'; // Simple sequential
      default:
        return '101'; // Default floor-based
    }
  }

  async addProperty(
    cxt: IRequestContext,
    propertyData: { scannedFiles?: ExtractedMediaFile[] } & NewPropertyType
  ): Promise<ISuccessReturnData> {
    const {
      params: { cid },
    } = cxt.request;
    const currentuser = cxt.currentuser!;
    const start = process.hrtime.bigint();

    this.log.info('Starting property creation process');

    const validationResult = PropertyValidationService.validateProperty(propertyData);
    if (!validationResult.valid) {
      this.log.error(
        {
          cid,
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
        message: 'Property validation failed. Please correct the errors and try again.',
        errorInfo,
      });
    }

    const session = await this.propertyDAO.startSession();
    const result = await this.propertyDAO.withTransaction(session, async (session) => {
      const client = await this.clientDAO.getClientByCid(cid);
      if (!client) {
        this.log.error(`Client with cid ${cid} not found`);
        throw new BadRequestError({ message: 'Unable to add property to this account.' });
      }

      const fullAddress = propertyData.address.fullAddress;
      // address uniqueness check
      if (fullAddress && cid) {
        const existingProperty = await this.propertyDAO.findPropertyByAddress(
          fullAddress,
          cid.toString()
        );

        if (existingProperty) {
          throw new InvalidRequestError({
            message: 'A property with this address already exists for this client',
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
          cid,
        },
        session
      );

      if (!property) {
        throw new BadRequestError({ message: 'Unable to create property.' });
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

    await this.propertyCache.cacheProperty(cid, result.property.id, result.property);
    return { success: true, data: result.property, message: 'Property created successfully.' };
  }

  private propertyTypeValidation(propertyData: NewPropertyType): void {
    const { propertyType, totalUnits = 1, specifications, fees } = propertyData;

    if (!propertyType) return;

    const rules = PropertyTypeManager.getRules(propertyType);
    const errors: string[] = [];

    if (rules.isMultiUnit) {
      if (totalUnits < rules.minUnits) {
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
        message: 'Property type business rule validation failed',
        errorInfo: { propertyType: errors },
      });
    }
  }

  async addPropertiesFromCsv(
    cid: string,
    csvFilePath: string,
    actorId: string
  ): Promise<ISuccessReturnData> {
    if (!csvFilePath || !cid) {
      throw new BadRequestError({ message: 'No CSV file path provided' });
    }
    const client = await this.clientDAO.getClientByCid(cid);
    if (!client) {
      this.log.error(`Client with cid ${cid} not found`);
      throw new BadRequestError({ message: 'Unable to add property to this account.' });
    }

    const jobData = {
      csvFilePath,
      cid,
      userId: actorId,
    };

    const job = await this.propertyQueue.addCsvImportJob(jobData);
    return {
      success: true,
      data: { processId: job.id },
      message: 'CSV import job started',
    };
  }

  async updatePropertyDocuments(
    propertyId: string,
    uploadResult: UploadResult[],
    userid: string
  ): Promise<ISuccessReturnData> {
    if (!propertyId) {
      throw new BadRequestError({ message: 'Property ID is required.' });
    }

    if (!uploadResult || uploadResult.length === 0) {
      throw new BadRequestError({ message: 'Upload result is required.' });
    }
    const property = await this.propertyDAO.findById(propertyId);
    if (!property) {
      throw new BadRequestError({ message: 'Unable to find client property.' });
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
    cid: string,
    csvFile: ExtractedMediaFile,
    currentUser: ICurrentUser
  ): Promise<ISuccessReturnData> {
    if (!csvFile) {
      throw new BadRequestError({ message: 'No CSV file uploaded' });
    }

    const client = await this.clientDAO.getClientByCid(cid);
    if (!client) {
      this.log.error(`Client with cid ${cid} not found`);
      throw new BadRequestError({ message: 'Unable to validate csv for this account.' });
    }

    if (csvFile.fileSize > 10 * 1024 * 1024) {
      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFile.path]);
      throw new BadRequestError({ message: 'File size too large for processing.' });
    }

    const jobData = {
      cid,
      userId: currentUser.sub,
      csvFilePath: csvFile.path,
    };
    const job = await this.propertyQueue.addCsvValidationJob(jobData);
    return {
      success: true,
      data: { processId: job.id },
      message: 'CSV validation process started.',
    };
  }

  async getClientProperties(
    cid: string,
    queryParams: IPropertyFilterQuery
  ): Promise<
    ISuccessReturnData<{
      items: IPropertyDocument[];
      pagination: PaginateResult | undefined;
    }>
  > {
    if (!cid) {
      throw new BadRequestError({ message: 'Client ID is required.' });
    }

    const client = await this.clientDAO.getClientByCid(cid);
    if (!client) {
      this.log.error(`Client with cid ${cid} not found`);
      throw new BadRequestError({ message: 'Unable to get properties for this account.' });
    }

    const { pagination, filters } = queryParams;
    const filter: FilterQuery<IPropertyDocument> = {
      cid,
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
    const cachedResult = await this.propertyCache.getClientProperties(cid, opts);
    if (cachedResult.success && cachedResult.data) {
      return {
        success: true,
        data: {
          items: cachedResult.data.properties,
          pagination: cachedResult.data.pagination,
        },
      };
    }
    const properties = await this.propertyDAO.getPropertiesByClientId(cid, filter, opts);
    await this.propertyCache.saveClientProperties(cid, properties.data, {
      filter,
      pagination: opts,
    });

    return {
      success: true,
      data: {
        items: properties.data,
        pagination: properties.pagination,
      },
    };
  }

  async getClientProperty(
    cid: string,
    pid: string,
    _currentUser: ICurrentUser
  ): Promise<ISuccessReturnData> {
    if (!cid || !pid) {
      throw new BadRequestError({ message: 'Client ID and Property ID are required.' });
    }

    const client = await this.clientDAO.getClientByCid(cid);
    if (!client) {
      this.log.error(`Client with cid ${cid} not found`);
      throw new BadRequestError({ message: 'Unable to get properties for this account.' });
    }

    const property = await this.propertyDAO.findFirst({
      pid,
      cid,
      deletedAt: null,
    });
    if (!property) {
      throw new NotFoundError({ message: 'Unable to find property.' });
    }

    // Get unit information using the new logic that handles single vs multi-unit properties
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
      cid: string;
      pid: string;
      currentuser: ICurrentUser;
    },
    updateData: Partial<IPropertyDocument>
  ): Promise<ISuccessReturnData> {
    const { cid, pid } = ctx;

    if (!cid || !pid) {
      this.log.error('Client ID and Property ID are required');
      throw new BadRequestError({ message: 'Client ID and Property ID are required.' });
    }

    const client = await this.clientDAO.getClientByCid(cid);
    if (!client) {
      this.log.error(`Client with cid ${cid} not found`);
      throw new InvalidRequestError({ message: 'Client not found.' });
    }

    const property = await this.propertyDAO.findFirst({
      pid,
      cid,
      deletedAt: null,
    });
    if (!property) {
      throw new NotFoundError({ message: 'Unable to find property.' });
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
          message: 'Update validation failed. Please correct the errors and try again.',
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
        cid,
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

    await this.propertyCache.invalidateProperty(cid, property.id);
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
      const totalUnits = updateData.totalUnits || existingProperty.totalUnits || 1;
      if (totalUnits <= 1) {
        errors.push('Single-unit properties cannot be partially occupied');
      }
    }

    if (errors.length > 0) {
      throw new ValidationRequestError({
        message: 'Occupancy status change validation failed',
        errorInfo: { occupancyStatus: errors },
      });
    }
  }

  async archiveClientProperty(
    cid: string,
    pid: string,
    currentUser: ICurrentUser
  ): Promise<ISuccessReturnData> {
    if (!cid || !pid) {
      this.log.error('Client ID and Property ID are required');
      throw new BadRequestError({ message: 'Client ID and Property ID are required' });
    }

    const client = await this.clientDAO.getClientByCid(cid);
    if (!client) {
      this.log.error(`Client with cid ${cid} not found`);
      throw new BadRequestError({ message: 'Unable to archive property.' });
    }

    const property = await this.propertyDAO.findFirst({
      pid,
      cid,
      deletedAt: null,
    });
    if (!property) {
      throw new NotFoundError({ message: 'Unable to find property.' });
    }

    const archivedProperty = await this.propertyDAO.archiveProperty(property.id, currentUser.sub);

    if (!archivedProperty) {
      throw new BadRequestError({ message: 'Unable to archive property.' });
    }

    await this.propertyCache.invalidateProperty(cid, property.id);
    await this.propertyCache.invalidatePropertyLists(cid);

    return { success: true, data: null, message: 'Property archived successfully' };
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
      this.log.debug('Ignoring upload completed event for non-property resource', {
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
            error: markFailedError instanceof Error ? markFailedError.message : 'Unknown error',
            propertyId: resourceId,
          },
          'Failed to mark documents as failed after upload processing error'
        );
      }
    }
  }

  private async handleUploadFailed(payload: UploadFailedPayload): Promise<void> {
    const { error, resourceType, resourceId } = payload;

    this.log.info('Received UPLOAD_FAILED event', {
      resourceType,
      resourceId,
      error: error.message,
    });

    try {
      await this.markDocumentsAsFailed(resourceId, error.message);

      this.log.info('Successfully processed upload failed event', {
        propertyId: resourceId,
      });
    } catch (markFailedError) {
      this.log.error('Error processing upload failed event', {
        error: markFailedError instanceof Error ? markFailedError.message : 'Unknown error',
        propertyId: resourceId,
      });
    }
  }
}
