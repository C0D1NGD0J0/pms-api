import Logger from 'bunyan';
import { t } from '@shared/languages';
import sanitizeHtml from 'sanitize-html';
import { FilterQuery, Types } from 'mongoose';
import { PropertyCache } from '@caching/index';
import { GeoCoderService } from '@services/external';
import { PropertyQueue, UploadQueue } from '@queues/index';
import { NotificationService } from '@services/notification';
import { ICurrentUser, IUserRole } from '@interfaces/user.interface';
import { PropertyTypeManager } from '@services/property/PropertyTypeManager';
import { PropertyUnitDAO, PropertyDAO, ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { UploadCompletedPayload, UploadFailedPayload, EventTypes } from '@interfaces/index';
import { PropertyCsvProcessor, EventEmitterService, MediaUploadService } from '@services/index';
import {
  ValidationRequestError,
  InvalidRequestError,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '@shared/customErrors';
import {
  ExtractedMediaFile,
  ISuccessReturnData,
  IPaginationQuery,
  IRequestContext,
  ResourceContext,
  PaginateResult,
  UploadResult,
} from '@interfaces/utils.interface';
import {
  PROPERTY_CREATION_ALLOWED_DEPARTMENTS,
  PROPERTY_APPROVAL_ROLES,
  createSafeMongoUpdate,
  PROPERTY_STAFF_ROLES,
  getRequestDuration,
  createLogger,
  MoneyUtils,
} from '@utils/index';
import {
  PropertyApprovalStatusEnum,
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
  notificationService: NotificationService;
  mediaUploadService: MediaUploadService;
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
  private readonly mediaUploadService: MediaUploadService;
  private readonly userDAO: UserDAO;
  private readonly notificationService: NotificationService;

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
    mediaUploadService,
    userDAO,
    notificationService,
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
    this.mediaUploadService = mediaUploadService;
    this.userDAO = userDAO;
    this.notificationService = notificationService;

    this.setupEventListeners();
  }

  /**
   * Utility method to convert user role string to IUserRole enum value
   */
  private convertUserRoleToEnum(userRole: string): IUserRole {
    const upperRole = userRole.toUpperCase() as keyof typeof IUserRole;
    return IUserRole[upperRole] as IUserRole;
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

    if (!cuid) {
      throw new BadRequestError({ message: t('property.errors.clientIdRequired') });
    }

    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client) {
      this.log.error(`Client with cuid ${cuid} not found`);
      throw new BadRequestError({ message: t('property.errors.unableToAdd') });
    }

    const userRole = currentuser.client.role;
    const userRoleEnum = this.convertUserRoleToEnum(userRole);
    if (
      !PROPERTY_STAFF_ROLES.includes(userRoleEnum) &&
      !PROPERTY_APPROVAL_ROLES.includes(userRoleEnum)
    ) {
      throw new InvalidRequestError({ message: 'You are not authorized to create properties.' });
    }

    const cleanPropertyData = { ...propertyData };

    if (cleanPropertyData.fees) {
      cleanPropertyData.fees = MoneyUtils.parseMoneyInput(cleanPropertyData.fees);
    }

    const validationResult = PropertyValidationService.validateProperty(cleanPropertyData);
    if (!validationResult.valid) {
      this.log.error(
        {
          cuid,
          url: cxt.request.url,
          userId: currentuser.sub,
          requestId: cxt.requestId,
          errors: validationResult.errors,
          propertyType: cleanPropertyData.propertyType,
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

    const fullAddress = cleanPropertyData.address.fullAddress;
    if (fullAddress) {
      const existingProperty = await this.propertyDAO.findPropertyByAddress(fullAddress, cuid);
      if (existingProperty) {
        throw new InvalidRequestError({
          message: t('property.errors.duplicateAddress'),
        });
      }
    }

    this.propertyTypeValidation(cleanPropertyData);

    let approvalStatus: PropertyApprovalStatusEnum;
    let approvalDetails: any[];
    let message: string;

    if (PROPERTY_APPROVAL_ROLES.includes(userRoleEnum)) {
      // Admin or Manager - auto-approve
      approvalStatus = PropertyApprovalStatusEnum.APPROVED;
      approvalDetails = [
        {
          action: 'approved',
          timestamp: new Date(),
          actor: new Types.ObjectId(currentuser.sub),
        },
      ];
      message = t('property.success.created');
      this.log.info('Property auto-approved for admin/manager', {
        userId: currentuser.sub,
        role: userRole,
      });
    } else if (PROPERTY_STAFF_ROLES.includes(userRoleEnum)) {
      // Staff - check department and require approval
      const userProfile = await this.profileDAO.getProfileByUserId(currentuser.sub);
      const userDepartment = userProfile?.employeeInfo?.department;

      if (
        !userDepartment ||
        !PROPERTY_CREATION_ALLOWED_DEPARTMENTS.includes(userDepartment as any)
      ) {
        throw new InvalidRequestError({
          message:
            'You are not authorized to create properties. Only staff in Operations or Management departments can create properties.',
        });
      }

      approvalStatus = PropertyApprovalStatusEnum.PENDING;
      approvalDetails = [
        {
          action: 'created',
          actor: new Types.ObjectId(currentuser.sub),
          timestamp: new Date(),
        },
      ];
      message = 'Property submitted for approval';
      this.log.info('Property pending approval for staff', {
        userId: currentuser.sub,
        department: userDepartment,
      });
    } else {
      throw new InvalidRequestError({
        message: 'You are not authorized to create properties.',
      });
    }

    cleanPropertyData.createdBy = new Types.ObjectId(currentuser.sub);

    if (cleanPropertyData.managedBy) {
      cleanPropertyData.managedBy = new Types.ObjectId(cleanPropertyData.managedBy);
    } else if (PROPERTY_APPROVAL_ROLES.includes(userRoleEnum)) {
      // admin/manager can manage their own properties
      cleanPropertyData.managedBy = new Types.ObjectId(currentuser.sub);
    } else {
      // fallback to client's accountAdmin
      const client = await this.clientDAO.findFirst({ cuid });
      const accountAdminId = client?.accountAdmin?.toString();
      cleanPropertyData.managedBy = accountAdminId
        ? new Types.ObjectId(accountAdminId)
        : new Types.ObjectId(currentuser.sub); // last resort fallback
    }

    const session = await this.propertyDAO.startSession();
    const result = await this.propertyDAO.withTransaction(session, async (session) => {
      const property = await this.propertyDAO.createProperty(
        {
          ...cleanPropertyData,
          cuid,
          approvalStatus,
          approvalDetails,
        },
        session
      );

      if (!property) {
        throw new BadRequestError({ message: t('property.errors.unableToCreate') });
      }

      return property;
    });

    await this.propertyCache.cacheProperty(cuid, result.id, result);

    if (approvalStatus === PropertyApprovalStatusEnum.PENDING) {
      try {
        await this.notificationService.handlePropertyUpdateNotifications({
          userRole: currentuser.client.role,
          updatedProperty: result,
          propertyName: result.name,
          actorUserId: currentuser.sub,
          actorDisplayName: currentuser.displayName,
          cuid,
          updateData: cleanPropertyData,
          propertyManagerId: result.managedBy?.toString(),
          resource: {
            resourceType: ResourceContext.PROPERTY,
            resourceId: result.id,
            resourceUid: result.pid,
          },
        });
      } catch (notificationError) {
        this.log.error('Failed to send property creation notification', {
          error: notificationError instanceof Error ? notificationError.message : 'Unknown error',
          propertyId: result.pid,
          creatorId: currentuser.sub,
        });
      }
    }

    return { success: true, data: result, message };
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

      // multi-unit properties bedrooms/bathrooms should be managed at unit level
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
      clientInfo: { cuid, clientDisplayName: client.displayName, id: client.id },
    };

    const job = await this.propertyQueue.addCsvImportJob(jobData);
    return {
      success: true,
      data: { processId: job.id },
      message: t('property.success.csvImportStarted'),
    };
  }

  async updatePropertyDocuments(
    propertyUid: string,
    uploadResult: UploadResult[],
    userid: string
  ): Promise<ISuccessReturnData> {
    if (!propertyUid) {
      throw new BadRequestError({ message: t('property.errors.propertyIdRequired') });
    }

    if (!uploadResult || uploadResult.length === 0) {
      throw new BadRequestError({ message: t('property.errors.uploadResultRequired') });
    }
    const property = await this.propertyDAO.findFirst({
      pid: propertyUid,
      deletedAt: null,
    });
    if (!property) {
      throw new BadRequestError({ message: t('property.errors.unableToFind') });
    }

    const updatedProperty = await this.propertyDAO.updatePropertyDocument(
      propertyUid,
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
      clientInfo: { cuid, clientDisplayName: client.displayName, id: client.id },
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
    currentuser: ICurrentUser,
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

    const { pagination, filters } = queryParams || {};
    const filter: FilterQuery<IPropertyDocument> = {
      cuid,
      deletedAt: null,
      status: { $ne: 'inactive' },
    };

    const userRole = currentuser.client.role;
    const userRoleEnum = userRole.toUpperCase() as keyof typeof IUserRole;
    if (!PROPERTY_APPROVAL_ROLES.includes(IUserRole[userRoleEnum])) {
      filter.$or = [
        { approvalStatus: PropertyApprovalStatusEnum.APPROVED },
        {
          approvalStatus: PropertyApprovalStatusEnum.PENDING,
        },
      ];
    }

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
    }

    const opts: IPaginationQuery = {
      page: pagination.page,
      sort: pagination.sort,
      sortBy: pagination.sortBy,
      limit: Math.max(1, Math.min(pagination.limit || 10, 100)),
      skip: ((pagination.page || 1) - 1) * (pagination.limit || 10),
    };
    // const cachedResult = await this.propertyCache.getClientProperties(cuid, opts);
    // if (cachedResult.success && cachedResult.data) {
    //   return {
    //     success: true,
    //     data: {
    //       items: cachedResult.data.properties,
    //       pagination: cachedResult.data.pagination,
    //     },
    //   };
    // }
    const properties = await this.propertyDAO.getPropertiesByClientId(cuid, filter, opts);

    const itemsWithPreview = properties.items.map((property) => {
      const propertyObj = property.toObject ? property.toObject() : property;
      const pendingChangesPreview = this.generatePendingChangesPreview(property, currentuser);

      return {
        ...propertyObj,
        ...(pendingChangesPreview && { pendingChangesPreview }),
        fees: MoneyUtils.formatMoneyDisplay(propertyObj.fees),
      };
    });

    await this.propertyCache.saveClientProperties(cuid, properties.items, {
      filter,
      pagination: opts,
    });

    return {
      success: true,
      data: {
        items: itemsWithPreview,
        pagination: properties.pagination,
      },
    };
  }

  async getClientProperty(
    cuid: string,
    pid: string,
    currentUser: ICurrentUser
  ): Promise<ISuccessReturnData<IPropertyWithUnitInfo>> {
    if (!cuid || !pid) {
      throw new BadRequestError({ message: t('property.errors.clientAndPropertyIdRequired') });
    }

    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client) {
      this.log.error(`Client with cuid ${cuid} not found`);
      throw new BadRequestError({ message: 'Unable to get properties for this account.' });
    }

    const property = await this.propertyDAO.findPropertyWithActiveMedia({
      pid,
      cuid,
      deletedAt: null,
    });
    if (!property) {
      throw new NotFoundError({ message: t('property.errors.notFound') });
    }

    const unitInfo = await this.getUnitInfoForProperty(property);

    const propertyObj = property.toObject ? property.toObject() : property;
    const pendingChangesPreview = this.generatePendingChangesPreview(property, currentUser);

    const propertyWithPreview = {
      ...propertyObj,
      ...(pendingChangesPreview && { pendingChangesPreview }),
      fees: MoneyUtils.formatMoneyDisplay(propertyObj.fees),
    };

    return {
      success: true,
      data: {
        property: propertyWithPreview,
        unitInfo,
      },
    };
  }

  async updateClientProperty(
    ctx: {
      cuid: string;
      pid: string;
      currentuser: ICurrentUser;
      hardDelete?: boolean;
    },
    updateData: Partial<IPropertyDocument>
  ): Promise<ISuccessReturnData> {
    const { cuid, pid, hardDelete = false } = ctx;

    // Validate input and permissions
    if (!cuid || !pid) {
      throw new BadRequestError({ message: t('property.errors.clientAndPropertyIdRequired') });
    }

    const property = await this.propertyDAO.findFirst({ pid, cuid, deletedAt: null });
    if (!property) {
      throw new NotFoundError({ message: t('property.errors.notFound') });
    }

    // Check user authorization
    const userRole = ctx.currentuser.client.role;
    const userRoleEnum = this.convertUserRoleToEnum(userRole);
    if (
      !PROPERTY_STAFF_ROLES.includes(userRoleEnum) &&
      !PROPERTY_APPROVAL_ROLES.includes(userRoleEnum)
    ) {
      throw new ForbiddenError({ message: 'You are not authorized to update properties.' });
    }

    // Process update data
    const { images, documents, ...restUpdateData } = updateData;
    const cleanUpdateData: Partial<IPropertyDocument> = { ...restUpdateData };

    // Parse money fields
    if (cleanUpdateData.fees) {
      cleanUpdateData.fees = MoneyUtils.parseMoneyInput(cleanUpdateData.fees);
    }

    // Sanitize HTML content
    if (cleanUpdateData.description?.text) {
      cleanUpdateData.description = {
        text: sanitizeHtml(cleanUpdateData.description.text),
        html: sanitizeHtml(cleanUpdateData.description.html || ''),
      };
    }

    // Handle media deletion
    if (images?.length || documents?.length) {
      const deletionTasks = [];
      if (images?.length) {
        deletionTasks.push(
          this.mediaUploadService.handleMediaDeletion([], images, ctx.currentuser.sub, hardDelete)
        );
        cleanUpdateData.images = images;
      }
      if (documents?.length) {
        deletionTasks.push(
          this.mediaUploadService.handleMediaDeletion(
            [],
            documents,
            ctx.currentuser.sub,
            hardDelete
          )
        );
        cleanUpdateData.documents = documents;
      }
      await Promise.all(deletionTasks);
    }

    // Validate occupancy status change
    if (cleanUpdateData.occupancyStatus) {
      this.validateOccupancyStatusChange(property, cleanUpdateData);
    }

    // checks for concurrent updates (optimistic locking) - staff only
    if (PROPERTY_STAFF_ROLES.includes(userRoleEnum) && property.pendingChanges) {
      const pendingChanges = property.pendingChanges as any;
      const lockedByUserId = pendingChanges.updatedBy?.toString();

      // Check if another user has pending changes
      if (lockedByUserId && lockedByUserId !== ctx.currentuser.sub) {
        const lockedByDisplayName = pendingChanges.displayName || 'Another user';
        const lockedAt = pendingChanges.updatedAt
          ? new Date(pendingChanges.updatedAt).toLocaleString()
          : 'recently';

        throw new BadRequestError({
          message: `Cannot edit property - ${lockedByDisplayName} has pending changes since ${lockedAt}. Changes must be approved or rejected before further edits can be made.`,
        });
      }
    }

    // Determine save strategy and execute update
    let updatedProperty: IPropertyDocument;
    let message: string;

    if (PROPERTY_STAFF_ROLES.includes(userRoleEnum)) {
      // Staff update - store in pendingChanges
      const result = await this.propertyDAO.update(
        { cuid, pid, deletedAt: null },
        {
          $set: {
            pendingChanges: {
              ...cleanUpdateData,
              updatedBy: new Types.ObjectId(ctx.currentuser.sub),
              updatedAt: new Date(),
              displayName: ctx.currentuser.fullname,
            },
            approvalStatus: PropertyApprovalStatusEnum.PENDING,
            lastModifiedBy: new Types.ObjectId(ctx.currentuser.sub),
          },
        }
      );
      if (!result) {
        throw new BadRequestError({ message: 'Unable to update property.' });
      }
      updatedProperty = result;
      message = 'Property changes submitted for approval';
    } else {
      // Admin/Manager direct update
      const safeUpdateData = createSafeMongoUpdate(cleanUpdateData);
      const result = await this.propertyDAO.update(
        { cuid, pid, deletedAt: null },
        {
          $set: {
            ...safeUpdateData,
            approvalStatus: PropertyApprovalStatusEnum.APPROVED,
            lastModifiedBy: new Types.ObjectId(ctx.currentuser.sub),
          },
          $push: {
            approvalDetails: {
              timestamp: new Date(),
              action: 'updated' as const,
              actor: new Types.ObjectId(ctx.currentuser.sub),
            },
          },
        }
      );
      if (!result) {
        throw new BadRequestError({ message: 'Unable to update property.' });
      }
      updatedProperty = result;
      message = 'Property updated successfully';
    }

    // Cache invalidation and notifications
    await this.propertyCache.invalidateProperty(cuid, property.id);
    await this.notificationService.handlePropertyUpdateNotifications({
      userRole: ctx.currentuser.client.role,
      updatedProperty,
      propertyName: updatedProperty.name || property.name || 'Unknown Property',
      actorUserId: ctx.currentuser.sub,
      actorDisplayName: ctx.currentuser.displayName,
      cuid,
      updateData: cleanUpdateData,
      propertyManagerId: updatedProperty.managedBy?.toString(),
      resource: {
        resourceType: ResourceContext.PROPERTY,
        resourceId: updatedProperty.id,
        resourceUid: updatedProperty.pid,
      },
    });

    return { success: true, data: updatedProperty, message };
  }

  async getPendingApprovals(
    cuid: string,
    currentuser: ICurrentUser,
    pagination: IPaginationQuery
  ): Promise<ISuccessReturnData<{ items: IPropertyDocument[]; pagination?: PaginateResult }>> {
    const userRole = currentuser.client.role;
    if (!PROPERTY_APPROVAL_ROLES.includes(this.convertUserRoleToEnum(userRole))) {
      throw new InvalidRequestError({
        message: 'You are not authorized to view pending approvals.',
      });
    }

    const filter: FilterQuery<IPropertyDocument> = {
      cuid,
      deletedAt: null,
      approvalStatus: 'pending',
    };

    const opts: IPaginationQuery = {
      page: pagination.page || 1,
      limit: Math.max(1, Math.min(pagination.limit || 10, 100)),
      sort: pagination.sort || '-createdAt',
      sortBy: pagination.sortBy || 'createdAt',
      skip: ((pagination.page || 1) - 1) * (pagination.limit || 10),
    };

    const properties = await this.propertyDAO.getPropertiesByClientId(cuid, filter, opts);

    return {
      success: true,
      data: {
        items: properties.items,
        pagination: properties.pagination,
      },
      message: 'Pending approvals retrieved successfully',
    };
  }

  async approveProperty(
    cuid: string,
    pid: string,
    currentuser: ICurrentUser,
    notes?: string
  ): Promise<ISuccessReturnData> {
    const userRole = currentuser.client.role;
    if (!PROPERTY_APPROVAL_ROLES.includes(this.convertUserRoleToEnum(userRole))) {
      throw new InvalidRequestError({
        message: 'You are not authorized to approve properties.',
      });
    }

    const property = await this.propertyDAO.findFirst({
      pid,
      cuid,
      deletedAt: null,
    });

    if (!property) {
      throw new NotFoundError({ message: t('property.errors.notFound') });
    }

    if (property.approvalStatus === 'approved' && !property.pendingChanges) {
      throw new InvalidRequestError({
        message: 'Property is already approved and has no pending changes.',
      });
    }

    // Create new approval entry for the array
    const approvalEntry = {
      action: 'approved' as const,
      actor: new Types.ObjectId(currentuser.sub),
      timestamp: new Date(),
      ...(notes && { notes }),
    };

    let updateData: any = {
      approvalStatus: 'approved',
      $push: { approvalDetails: approvalEntry },
      lastModifiedBy: new Types.ObjectId(currentuser.sub),
    };

    // If there are pending changes, apply them to the main fields
    if (property.pendingChanges) {
      // Use createSafeMongoUpdate to prevent nested object overwrites
      const safeChanges = createSafeMongoUpdate(property.pendingChanges);

      // Apply pending changes to main fields and clear them
      updateData = {
        ...updateData,
        $set: {
          ...safeChanges,
          pendingChanges: null, // Clear pending changes after applying
          approvalStatus: 'approved',
          lastModifiedBy: new Types.ObjectId(currentuser.sub),
        },
        $push: { approvalDetails: approvalEntry },
      };

      this.log.info('Applying pending changes during approval with safe updates', {
        propertyId: property.id,
        pendingChanges: Object.keys(property.pendingChanges),
        safeUpdateFields: Object.keys(safeChanges),
      });
    }

    const updatedProperty = await this.propertyDAO.update(
      { pid, cuid, deletedAt: null },
      updateData
    );

    if (!updatedProperty) {
      throw new BadRequestError({ message: 'Unable to approve property.' });
    }

    await this.propertyCache.invalidateProperty(cuid, property.id);
    await this.propertyCache.invalidatePropertyLists(cuid);

    this.log.info('Property approved', {
      propertyId: property.id,
      approvedBy: currentuser.sub,
      hadPendingChanges: !!property.pendingChanges,
    });

    // Send approval notification
    try {
      const originalRequesterId =
        property.pendingChanges?.updatedBy?.toString() ||
        this.getOriginalRequesterId(
          Array.isArray(property.approvalDetails) ? property.approvalDetails : []
        );

      if (originalRequesterId) {
        await this.notificationService.notifyApprovalDecision(
          updatedProperty.pid,
          updatedProperty.name || 'Unknown Property',
          currentuser.sub,
          cuid,
          'approved',
          originalRequesterId,
          notes,
          {
            address: updatedProperty.address?.fullAddress,
            hadPendingChanges: !!property.pendingChanges,
          }
        );
      }
    } catch (notificationError) {
      this.log.error('Failed to send approval notification', {
        error: notificationError instanceof Error ? notificationError.message : 'Unknown error',
        propertyId: updatedProperty.pid,
        approverId: currentuser.sub,
      });
    }

    return {
      success: true,
      data: updatedProperty,
      message: property.pendingChanges
        ? 'Property changes approved and applied successfully'
        : 'Property approved successfully',
    };
  }

  async rejectProperty(
    cuid: string,
    pid: string,
    currentuser: ICurrentUser,
    reason: string
  ): Promise<ISuccessReturnData> {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestError({ message: 'Rejection reason is required.' });
    }

    // Check if user has permission
    const userRole = currentuser.client.role;
    if (!PROPERTY_APPROVAL_ROLES.includes(this.convertUserRoleToEnum(userRole))) {
      throw new InvalidRequestError({
        message: 'You are not authorized to reject properties.',
      });
    }

    const property = await this.propertyDAO.findFirst({
      pid,
      cuid,
      deletedAt: null,
    });

    if (!property) {
      throw new NotFoundError({ message: t('property.errors.notFound') });
    }

    // Create new rejection entry for the array
    const rejectionEntry = {
      action: 'rejected' as const,
      actor: new Types.ObjectId(currentuser.sub),
      timestamp: new Date(),
      rejectionReason: reason.trim(),
    };

    // Determine the appropriate status after rejection
    const updateData: any = {
      $push: { approvalDetails: rejectionEntry },
      lastModifiedBy: new Types.ObjectId(currentuser.sub),
    };

    // If property has pending changes, clear them and keep status as approved (using old data)
    if (property.pendingChanges) {
      updateData.pendingChanges = null; // Clear pending changes
      // Keep approvalStatus as 'approved' since we're keeping the old approved data

      this.log.info('Clearing pending changes on rejection', {
        propertyId: property.id,
        hadPendingChanges: true,
      });
    } else {
      // If no pending changes, this is a new property being rejected
      updateData.approvalStatus = 'rejected';
    }

    const updatedProperty = await this.propertyDAO.update(
      { pid, cuid, deletedAt: null },
      { $set: updateData }
    );

    if (!updatedProperty) {
      throw new BadRequestError({ message: 'Unable to reject property.' });
    }

    await this.propertyCache.invalidateProperty(cuid, property.id);
    await this.propertyCache.invalidatePropertyLists(cuid);

    this.log.info('Property rejected', {
      propertyId: property.id,
      rejectedBy: currentuser.sub,
      reason,
      hadPendingChanges: !!property.pendingChanges,
    });

    // Send rejection notification
    try {
      const originalRequesterId =
        property.pendingChanges?.updatedBy?.toString() ||
        this.getOriginalRequesterId(
          Array.isArray(property.approvalDetails) ? property.approvalDetails : []
        );

      if (originalRequesterId) {
        await this.notificationService.notifyApprovalDecision(
          updatedProperty.pid,
          updatedProperty.name || property.name || 'Unknown Property',
          currentuser.sub,
          cuid,
          'rejected',
          originalRequesterId,
          reason.trim(),
          {
            address: updatedProperty.address?.fullAddress || property.address?.fullAddress,
            hadPendingChanges: !!property.pendingChanges,
          }
        );
      }
    } catch (notificationError) {
      this.log.error('Failed to send rejection notification', {
        error: notificationError instanceof Error ? notificationError.message : 'Unknown error',
        propertyId: updatedProperty.pid,
        rejectorId: currentuser.sub,
      });
    }

    return {
      success: true,
      data: updatedProperty,
      message: property.pendingChanges
        ? 'Property changes rejected. Original data preserved.'
        : 'Property rejected',
    };
  }

  async bulkApproveProperties(
    cuid: string,
    propertyIds: string[],
    currentuser: ICurrentUser
  ): Promise<ISuccessReturnData> {
    // Check if user has permission
    const userRole = currentuser.client.role;
    if (!PROPERTY_APPROVAL_ROLES.includes(this.convertUserRoleToEnum(userRole))) {
      throw new InvalidRequestError({
        message: 'You are not authorized to bulk approve properties.',
      });
    }

    if (!propertyIds || propertyIds.length === 0) {
      throw new BadRequestError({ message: 'Property IDs are required.' });
    }

    const updateData = {
      approvalStatus: 'approved',
      'approvalDetails.approvedBy': new Types.ObjectId(currentuser.sub),
      'approvalDetails.approvedAt': new Date(),
      'approvalDetails.requiresReapproval': false,
      lastModifiedBy: new Types.ObjectId(currentuser.sub),
    };

    const result = await this.propertyDAO.updateMany(
      {
        pid: { $in: propertyIds },
        cuid,
        deletedAt: null,
        approvalStatus: 'pending',
      },
      { $set: updateData }
    );

    await this.propertyCache.invalidatePropertyLists(cuid);

    this.log.info('Properties bulk approved', {
      count: result.modifiedCount,
      approvedBy: currentuser.sub,
    });

    return {
      success: true,
      data: { approved: result.modifiedCount, total: propertyIds.length },
      message: `${result.modifiedCount} properties approved successfully`,
    };
  }

  async bulkRejectProperties(
    cuid: string,
    propertyIds: string[],
    currentuser: ICurrentUser,
    reason: string
  ): Promise<ISuccessReturnData> {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestError({ message: 'Rejection reason is required.' });
    }

    // Check if user has permission
    const userRole = currentuser.client.role;
    if (!PROPERTY_APPROVAL_ROLES.includes(this.convertUserRoleToEnum(userRole))) {
      throw new InvalidRequestError({
        message: 'You are not authorized to bulk reject properties.',
      });
    }

    if (!propertyIds || propertyIds.length === 0) {
      throw new BadRequestError({ message: 'Property IDs are required.' });
    }

    const updateData = {
      approvalStatus: 'rejected',
      'approvalDetails.rejectedBy': new Types.ObjectId(currentuser.sub),
      'approvalDetails.rejectedAt': new Date(),
      'approvalDetails.rejectionReason': reason.trim(),
      lastModifiedBy: new Types.ObjectId(currentuser.sub),
    };

    const result = await this.propertyDAO.updateMany(
      {
        pid: { $in: propertyIds },
        cuid,
        deletedAt: null,
        approvalStatus: 'pending',
      },
      { $set: updateData }
    );

    await this.propertyCache.invalidatePropertyLists(cuid);

    this.log.info('Properties bulk rejected', {
      count: result.modifiedCount,
      rejectedBy: currentuser.sub,
      reason,
    });

    return {
      success: true,
      data: { rejected: result.modifiedCount, total: propertyIds.length },
      message: `${result.modifiedCount} properties rejected`,
    };
  }

  async getMyPropertyRequests(
    cuid: string,
    currentuser: ICurrentUser,
    filters: {
      approvalStatus?: 'pending' | 'approved' | 'rejected';
      pagination: IPaginationQuery;
    }
  ): Promise<ISuccessReturnData<{ items: IPropertyDocument[]; pagination?: PaginateResult }>> {
    const filter: FilterQuery<IPropertyDocument> = {
      cuid,
      deletedAt: null,
      createdBy: new Types.ObjectId(currentuser.sub),
    };

    if (filters.approvalStatus) {
      filter.approvalStatus = filters.approvalStatus;
    }

    const opts: IPaginationQuery = {
      page: filters.pagination.page || 1,
      limit: Math.max(1, Math.min(filters.pagination.limit || 10, 100)),
      sort: filters.pagination.sort || '-createdAt',
      sortBy: filters.pagination.sortBy || 'createdAt',
      skip: ((filters.pagination.page || 1) - 1) * (filters.pagination.limit || 10),
    };

    const properties = await this.propertyDAO.getPropertiesByClientId(cuid, filter, opts);

    return {
      success: true,
      data: {
        items: properties.items,
        pagination: properties.pagination,
      },
      message: 'Property requests retrieved successfully',
    };
  }

  /**
   * Helper method to find the original requester from approvalDetails array
   */
  private getOriginalRequesterId(approvalDetails: any[]): string | undefined {
    if (!Array.isArray(approvalDetails) || approvalDetails.length === 0) {
      return undefined;
    }

    // Find the first 'created' action which contains the original requester
    const createdEntry = approvalDetails.find((entry) => entry.action === 'created');
    return createdEntry?.actor?.toString();
  }

  private shouldShowPendingChanges(
    currentUser: ICurrentUser,
    property: IPropertyDocument
  ): boolean {
    // Return false if no pending changes exist
    if (!property.pendingChanges) {
      return false;
    }

    const userRole = currentUser.client.role;

    // Admin/managers can see all pending changes
    if (PROPERTY_APPROVAL_ROLES.includes(this.convertUserRoleToEnum(userRole))) {
      return true;
    }

    // Staff can only see their own pending changes
    if (PROPERTY_STAFF_ROLES.includes(this.convertUserRoleToEnum(userRole))) {
      const pendingChanges = property.pendingChanges as any;
      return pendingChanges.updatedBy?.toString() === currentUser.sub;
    }

    return false;
  }

  private generatePendingChangesPreview(
    property: IPropertyDocument,
    currentUser: ICurrentUser
  ): any {
    if (!property.pendingChanges || !this.shouldShowPendingChanges(currentUser, property)) {
      return undefined;
    }

    const pendingChanges = property.pendingChanges as any;
    const { updatedBy, updatedAt, ...changes } = pendingChanges;

    // Format fee values in pending changes for frontend display
    const formattedChanges = { ...changes };
    if (formattedChanges.fees) {
      formattedChanges.fees = MoneyUtils.formatMoneyDisplay(formattedChanges.fees);
    }

    const updatedFields = Object.keys(changes);
    const summary = this.generateChangesSummary(updatedFields);

    return {
      updatedFields,
      updatedAt,
      updatedBy,
      summary,
      changes: formattedChanges, // Include formatted pending changes
    };
  }

  private generateChangesSummary(updatedFields: string[]): string {
    if (updatedFields.length === 0) return 'No changes';

    const fieldNames = updatedFields.map((field) => {
      // Convert camelCase and nested fields to readable names
      return field
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (str) => str.toUpperCase())
        .replace(/\./g, ' > ');
    });

    if (fieldNames.length === 1) {
      return `Modified ${fieldNames[0]}`;
    } else if (fieldNames.length === 2) {
      return `Modified ${fieldNames[0]} and ${fieldNames[1]}`;
    } else {
      const lastField = fieldNames.pop();
      return `Modified ${fieldNames.join(', ')}, and ${lastField}`;
    }
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
    statistics: {
      occupied: number;
      vacant: number;
      maintenance: number;
      available: number;
      reserved: number;
      inactive: number;
    };
    totalUnits: number;
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
      const unitData = await this.propertyUnitDAO.getPropertyUnitInfo(property._id.toString());
      const canAddUnitResult = await this.propertyDAO.canAddUnitToProperty(property._id.toString());
      const availableSpaces = Math.max(0, maxAllowedUnits - unitData.currentUnits);

      let lastUnitNumber: string | undefined;
      let suggestedNextUnitNumber: string | undefined;

      if (unitData.currentUnits > 0) {
        try {
          const existingUnitNumbers = await this.propertyUnitDAO.getExistingUnitNumbers(
            property._id.toString()
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
                property._id.toString(),
                'sequential'
              );
            } else {
              // No numeric patterns found, get the last unit alphabetically
              lastUnitNumber = existingUnitNumbers.sort().pop();
              suggestedNextUnitNumber = await this.propertyUnitDAO.getNextAvailableUnitNumber(
                property._id.toString(),
                'custom'
              );
            }
          }
        } catch (error) {
          this.log.warn(
            `Error getting unit numbers for property ${property._id.toString()}:`,
            error
          );
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
        statistics: unitData.unitStats,
        totalUnits: unitData.currentUnits,
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
        statistics: unitStats,
        totalUnits: 1,
        unitStats,
      };
    }
  }

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
