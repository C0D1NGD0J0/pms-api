import Logger from 'bunyan';
import { t } from '@shared/languages';
import sanitizeHtml from 'sanitize-html';
import { FilterQuery, Types } from 'mongoose';
import { PropertyQueue } from '@queues/index';
import { PropertyCache } from '@caching/index';
import { QueueFactory } from '@services/queue';
import { GeoCoderService } from '@services/external';
import { ICurrentUser } from '@interfaces/user.interface';
import { LeaseStatus, EventTypes } from '@interfaces/index';
import { NotificationService } from '@services/notification';
import { ROLE_GROUPS, IUserRole } from '@shared/constants/roles.constants';
import { PropertyTypeManager } from '@services/property/PropertyTypeManager';
import { PropertyCsvProcessor, EventEmitterService, MediaUploadService } from '@services/index';
import { PropertyUnitDAO, PropertyDAO, ProfileDAO, ClientDAO, LeaseDAO, UserDAO } from '@dao/index';
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
  IPaginateResult,
} from '@interfaces/utils.interface';
import {
  PropertyApprovalStatusEnum,
  IAssignableUsersFilter,
  IPropertyWithUnitInfo,
  IPropertyFilterQuery,
  IPropertyDocument,
  IAssignableUser,
  NewPropertyType,
} from '@interfaces/property.interface';
import {
  PROPERTY_CREATION_ALLOWED_DEPARTMENTS,
  PROPERTY_APPROVAL_ROLES,
  createSafeMongoUpdate,
  convertUserRoleToEnum,
  PROPERTY_STAFF_ROLES,
  getRequestDuration,
  createLogger,
  MoneyUtils,
} from '@utils/index';

import { PropertyStatsService } from './propertyStats.service';
import { PropertyApprovalService } from './propertyApproval.service';
import { PropertyValidationService } from './propertyValidation.service';
import { generatePendingChangesPreview, validateOccupancyStatusChange } from './propertyHelpers';

interface IConstructor {
  propertyApprovalService: PropertyApprovalService;
  propertyCsvProcessor: PropertyCsvProcessor;
  propertyStatsService: PropertyStatsService;
  notificationService: NotificationService;
  mediaUploadService: MediaUploadService;
  emitterService: EventEmitterService;
  geoCoderService: GeoCoderService;
  propertyUnitDAO: PropertyUnitDAO;
  propertyCache: PropertyCache;
  queueFactory: QueueFactory;
  propertyDAO: PropertyDAO;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  leaseDAO: LeaseDAO;
  userDAO: UserDAO;
}

export class PropertyService {
  private readonly log: Logger;
  private readonly queueFactory: QueueFactory;
  private readonly clientDAO: ClientDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly propertyCache: PropertyCache;
  private readonly geoCoderService: GeoCoderService;
  private readonly emitterService: EventEmitterService;
  private readonly propertyCsvProcessor: PropertyCsvProcessor;
  private readonly mediaUploadService: MediaUploadService;
  private readonly propertyApprovalService: PropertyApprovalService;
  private readonly propertyStatsService: PropertyStatsService;
  private readonly userDAO: UserDAO;
  private readonly leaseDAO: LeaseDAO;
  private readonly notificationService: NotificationService;

  constructor({
    clientDAO,
    profileDAO,
    propertyDAO,
    propertyUnitDAO,
    queueFactory,
    propertyCache,
    emitterService,
    geoCoderService,
    propertyCsvProcessor,
    mediaUploadService,
    propertyApprovalService,
    propertyStatsService,
    userDAO,
    leaseDAO,
    notificationService,
  }: IConstructor) {
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.propertyDAO = propertyDAO;
    this.propertyUnitDAO = propertyUnitDAO;
    this.queueFactory = queueFactory;
    this.propertyCache = propertyCache;
    this.emitterService = emitterService;
    this.geoCoderService = geoCoderService;
    this.log = createLogger('PropertyService');
    this.propertyCsvProcessor = propertyCsvProcessor;
    this.mediaUploadService = mediaUploadService;
    this.propertyApprovalService = propertyApprovalService;
    this.propertyStatsService = propertyStatsService;
    this.userDAO = userDAO;
    this.leaseDAO = leaseDAO;
    this.notificationService = notificationService;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.emitterService.on(EventTypes.UNIT_CREATED, this.handleUnitChanged.bind(this));
    this.emitterService.on(EventTypes.UNIT_UPDATED, this.handleUnitChanged.bind(this));
    this.emitterService.on(EventTypes.UNIT_ARCHIVED, this.handleUnitChanged.bind(this));
    this.emitterService.on(EventTypes.UNIT_UNARCHIVED, this.handleUnitChanged.bind(this));
    this.emitterService.on(EventTypes.UNIT_STATUS_CHANGED, this.handleUnitChanged.bind(this));
    this.emitterService.on(EventTypes.UNIT_BATCH_CREATED, this.handleUnitBatchChanged.bind(this));

    this.emitterService.on(
      EventTypes.LEASE_ESIGNATURE_COMPLETED,
      this.handleLeaseActivated.bind(this)
    );

    this.emitterService.on(EventTypes.LEASE_TERMINATED, this.handleLeaseTerminated.bind(this));

    this.log.info(t('property.logging.eventListenersInitialized'));
  }

  private async handleLeaseActivated(payload: any): Promise<{
    success: boolean;
    message: string;
    data: any;
  }> {
    try {
      const { leaseId, propertyId, propertyUnitId } = payload;

      if (propertyUnitId) {
        this.log.info('Lease has propertyUnitId - skipping direct property update', {
          leaseId,
          propertyId,
        });
        return {
          success: false,
          message: 'Lease has propertyUnitId - skipping direct property update',
          data: null,
        };
      }

      let property = await this.propertyDAO.findById(propertyId);
      if (!property) {
        return {
          success: false,
          message: 'Property not found',
          data: null,
        };
      }

      if (property.occupancyStatus === 'occupied') {
        return {
          success: false,
          message: 'Property already marked as occupied',
          data: null,
        };
      }

      property = await this.propertyDAO.update(
        { _id: propertyId },
        {
          occupancyStatus: 'occupied',
          updatedAt: new Date(),
        }
      );

      return {
        success: true,
        data: property,
        message: 'Property marked as occupied',
      };
    } catch (error) {
      this.log.error('Error handling lease activation for property', {
        error: error instanceof Error ? error.message : 'Unknown error',
        payload,
      });
      return { success: false, message: 'Error handling lease activation', data: null };
    }
  }

  private async handleLeaseTerminated(payload: any): Promise<{
    success: boolean;
    message: string;
    data: any;
  }> {
    try {
      const { leaseId, propertyId, propertyUnitId } = payload;

      // Skip if this is a unit-level lease (unit service handles it)
      if (propertyUnitId) {
        this.log.info('Lease has propertyUnitId - skipping direct property update', {
          leaseId,
          propertyId,
        });
        return {
          success: false,
          message: 'Lease has propertyUnitId - skipping direct property update',
          data: null,
        };
      }

      // This is a property-level lease termination
      let property = await this.propertyDAO.findById(propertyId);
      if (!property) {
        return {
          success: false,
          message: 'Property not found',
          data: null,
        };
      }

      // Update property to vacant since property-level lease ended
      property = await this.propertyDAO.update(
        { _id: propertyId },
        {
          occupancyStatus: 'vacant',
          updatedAt: new Date(),
        }
      );

      return {
        success: true,
        data: property,
        message: 'Property marked as vacant after lease termination',
      };
    } catch (error) {
      this.log.error('Error handling lease termination for property', {
        error: error instanceof Error ? error.message : 'Unknown error',
        payload,
      });
      return { success: false, message: 'Error handling lease termination', data: null };
    }
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
    const userRoleEnum = convertUserRoleToEnum(userRole);
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

    const propertyQueue = this.queueFactory.getQueue('propertyQueue') as PropertyQueue;
    const job = await propertyQueue.addCsvImportJob(jobData);
    return {
      success: true,
      data: { processId: job.id },
      message: t('property.success.csvImportStarted'),
    };
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
    const propertyQueue = this.queueFactory.getQueue('propertyQueue') as PropertyQueue;
    const job = await propertyQueue.addCsvValidationJob(jobData);
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
      pagination: IPaginateResult | undefined;
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

    const properties = await this.propertyDAO.getPropertiesByClientId(cuid, filter, opts);
    const itemsWithPreview = properties.items.map((property) => {
      const propertyObj = property.toObject ? property.toObject() : property;
      const pendingChangesPreview = generatePendingChangesPreview(property, currentuser);

      return {
        ...propertyObj,
        ...(pendingChangesPreview && { pendingChangesPreview }),
        fees: MoneyUtils.formatMoneyDisplay(propertyObj.fees),
      };
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
    const pendingChangesPreview = generatePendingChangesPreview(property, currentUser);

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
    const userRoleEnum = convertUserRoleToEnum(userRole);
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
      validateOccupancyStatusChange(property, cleanUpdateData);
    }

    // Smart Approval Workflow Logic
    const hasPendingChanges = !!property.pendingChanges;
    let pendingChangesInfo: any = null;

    if (hasPendingChanges) {
      const pendingChanges = property.pendingChanges as any;
      pendingChangesInfo = {
        updatedBy: pendingChanges.updatedBy?.toString(),
        displayName: pendingChanges.displayName || 'Unknown User',
        updatedAt: pendingChanges.updatedAt,
      };
    }

    // STAFF LOGIC: Block if another user has pending changes
    if (PROPERTY_STAFF_ROLES.includes(userRoleEnum)) {
      if (hasPendingChanges) {
        const lockedByUserId = pendingChangesInfo.updatedBy;

        // Block if another user has pending changes
        if (lockedByUserId && lockedByUserId !== ctx.currentuser.sub) {
          const lockedAt = pendingChangesInfo.updatedAt
            ? new Date(pendingChangesInfo.updatedAt).toLocaleString()
            : 'recently';

          throw new BadRequestError({
            message: `Cannot edit property - ${pendingChangesInfo.displayName} has pending changes since ${lockedAt}. Changes must be approved or rejected before further edits can be made.`,
          });
        }
      }

      // staff update - store in pendingChanges
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

      // Send notification to approvers
      await this.handleUpdateNotifications(ctx, result, cleanUpdateData, false);

      return {
        success: true,
        data: result,
        message: 'Property changes submitted for approval',
      };
    }

    // ADMIN/MANAGER LOGIC: direct update with override handling
    if (PROPERTY_APPROVAL_ROLES.includes(userRoleEnum)) {
      let overrideMessage = '';
      let notifyStaffOfOverride = false;
      let originalRequesterId: string | undefined;

      // are we overriding pending changes
      if (hasPendingChanges) {
        originalRequesterId = pendingChangesInfo.updatedBy;
        overrideMessage = ` (overriding pending changes from ${pendingChangesInfo.displayName})`;
        notifyStaffOfOverride = true;

        this.log.info('Admin overriding pending changes', {
          propertyId: property.id,
          adminId: ctx.currentuser.sub,
          adminName: ctx.currentuser.displayName,
          originalRequesterId,
          originalRequesterName: pendingChangesInfo.displayName,
        });
      }

      // apply admin changes directly and clear pending changes
      const safeUpdateData = createSafeMongoUpdate(cleanUpdateData);
      const updateOperation: any = {
        $set: {
          ...safeUpdateData,
          approvalStatus: PropertyApprovalStatusEnum.APPROVED,
          lastModifiedBy: new Types.ObjectId(ctx.currentuser.sub),
          pendingChanges: null, // Clear any pending changes
        },
        $push: {
          approvalDetails: {
            timestamp: new Date(),
            action: hasPendingChanges ? 'overridden' : 'updated',
            actor: new Types.ObjectId(ctx.currentuser.sub),
            ...(overrideMessage && { notes: `Direct update${overrideMessage}` }),
          },
        },
      };

      const result = await this.propertyDAO.update({ cuid, pid, deletedAt: null }, updateOperation);

      if (!result) {
        throw new BadRequestError({ message: 'Unable to update property.' });
      }

      await this.propertyCache.invalidateProperty(ctx.cuid, result.id);
      await this.handleUpdateNotifications(ctx, result, cleanUpdateData, true);

      // notify staff if their pending changes were overridden
      if (notifyStaffOfOverride && originalRequesterId) {
        try {
          await this.notificationService.notifyPendingChangesOverridden(
            property.pid,
            property.name || 'Unknown Property',
            ctx.currentuser.sub,
            ctx.currentuser.displayName,
            originalRequesterId,
            cuid,
            {
              address: property.address?.fullAddress,
              overriddenAt: new Date(),
              overrideReason: 'Direct admin update with higher priority',
            }
          );
        } catch (notificationError) {
          this.log.error('Failed to send override notification to staff', {
            error: notificationError instanceof Error ? notificationError.message : 'Unknown error',
            propertyId: property.pid,
            adminId: ctx.currentuser.sub,
            originalRequesterId,
          });
        }
      }

      const message = hasPendingChanges
        ? `Property updated successfully${overrideMessage}`
        : 'Property updated successfully';

      return { success: true, data: result, message };
    }

    throw new ForbiddenError({ message: 'Unable to determine update strategy for user role.' });
  }

  /**
   * Helper method to handle update notifications
   */
  private async handleUpdateNotifications(
    ctx: { cuid: string; currentuser: ICurrentUser },
    updatedProperty: IPropertyDocument,
    updateData: Partial<IPropertyDocument>,
    isDirectUpdate: boolean
  ): Promise<void> {
    try {
      await this.notificationService.handlePropertyUpdateNotifications({
        userRole: ctx.currentuser.client.role,
        updatedProperty,
        propertyName: updatedProperty.name || 'Unknown Property',
        actorUserId: ctx.currentuser.sub,
        actorDisplayName: ctx.currentuser.displayName,
        cuid: ctx.cuid,
        updateData,
        propertyManagerId: updatedProperty.managedBy?.toString(),
        isDirectUpdate,
        resource: {
          resourceType: ResourceContext.PROPERTY,
          resourceId: updatedProperty.id,
          resourceUid: updatedProperty.pid,
        },
      });
    } catch (notificationError) {
      this.log.error('Failed to send update notification', {
        error: notificationError instanceof Error ? notificationError.message : 'Unknown error',
        propertyId: updatedProperty.pid,
        userId: ctx.currentuser.sub,
        isDirectUpdate,
      });
    }
  }

  async getPendingApprovals(
    cuid: string,
    currentuser: ICurrentUser,
    pagination: IPaginationQuery
  ): Promise<ISuccessReturnData<{ items: IPropertyDocument[]; pagination?: IPaginateResult }>> {
    return this.propertyApprovalService.getPendingApprovals(cuid, currentuser, pagination);
  }

  async approveProperty(
    cuid: string,
    pid: string,
    currentuser: ICurrentUser,
    notes?: string
  ): Promise<ISuccessReturnData> {
    return this.propertyApprovalService.approveProperty(cuid, pid, currentuser, notes);
  }

  async rejectProperty(
    cuid: string,
    pid: string,
    currentuser: ICurrentUser,
    reason: string
  ): Promise<ISuccessReturnData> {
    return this.propertyApprovalService.rejectProperty(cuid, pid, currentuser, reason);
  }

  async bulkApproveProperties(
    cuid: string,
    propertyIds: string[],
    currentuser: ICurrentUser
  ): Promise<ISuccessReturnData> {
    return this.propertyApprovalService.bulkApproveProperties(cuid, propertyIds, currentuser);
  }

  async bulkRejectProperties(
    cuid: string,
    propertyIds: string[],
    currentuser: ICurrentUser,
    reason: string
  ): Promise<ISuccessReturnData> {
    return this.propertyApprovalService.bulkRejectProperties(
      cuid,
      propertyIds,
      currentuser,
      reason
    );
  }

  async getMyPropertyRequests(
    cuid: string,
    currentuser: ICurrentUser,
    filters: {
      approvalStatus?: 'pending' | 'approved' | 'rejected';
      pagination: IPaginationQuery;
    }
  ): Promise<ISuccessReturnData<{ items: IPropertyDocument[]; pagination?: IPaginateResult }>> {
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

    // Business Rule: Cannot archive property with active leases
    const activeLeases = await this.leaseDAO.list(
      {
        cuid,
        'property.id': property._id,
        status: { $in: [LeaseStatus.ACTIVE, LeaseStatus.PENDING_SIGNATURE] },
        deletedAt: null,
      },
      {},
      true
    );

    if (activeLeases.items.length > 0) {
      throw new ValidationRequestError({
        message: 'Cannot archive property with active or pending leases',
        errorInfo: {
          property: [
            `This property has ${activeLeases.items.length} active or pending lease(s). Please terminate or cancel all leases before archiving the property.`,
          ],
        },
      });
    }

    const archivedProperty = await this.propertyDAO.archiveProperty(property.id, currentUser.sub);

    if (!archivedProperty) {
      throw new BadRequestError({ message: t('property.errors.unableToArchive') });
    }

    await this.propertyCache.invalidateProperty(cuid, property.id);
    await this.propertyCache.invalidatePropertyLists(cuid);

    return { success: true, data: null, message: t('property.success.archived') };
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
    return this.propertyStatsService.getUnitInfoForProperty(property);
  }

  async getAssignableUsers(
    cuid: string,
    currentuser: ICurrentUser,
    filters: IAssignableUsersFilter
  ): Promise<ISuccessReturnData<{ items: IAssignableUser[]; pagination?: IPaginateResult }>> {
    try {
      this.log.info('Fetching assignable users for client', { cuid, filters });

      // Validate client exists
      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        throw new NotFoundError({ message: t('client.errors.notFound') });
      }

      // Define management roles only (exclude vendor, tenant)
      const managementRoles = ROLE_GROUPS.EMPLOYEE_ROLES;
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

  /**
   * Get lease-able properties (available properties only)
   * Optionally fetch available units for properties that support units
   * @param cuid - Client unique identifier
   * @param currentuser - Current user making the request
   * @param fetchUnits - Whether to fetch available units for properties
   * @returns Properties with optional unit information
   */
  async getLeaseableProperties(
    cuid: string,
    currentuser: ICurrentUser,
    fetchUnits: boolean = false
  ): Promise<
    ISuccessReturnData<{
      items: Array<{
        id: string;
        name: string;
        address: string;
        propertyType: string;
        financialInfo?: {
          monthlyRent?: number;
          securityDeposit?: number;
          currency?: string;
        };
        units?: Array<{
          id: string;
          unitNumber: string;
          status: string;
          financialInfo?: {
            monthlyRent?: number;
            securityDeposit?: number;
            currency?: string;
          };
        }>;
      }>;
      metadata: {
        totalProperties: number;
        filteredCount: number;
        filteredProperties?: Array<{
          id: string;
          name: string;
          propertyType: string;
          reason: string;
        }>;
      } | null;
    }>
  > {
    try {
      if (!cuid) {
        throw new BadRequestError({ message: t('property.errors.clientIdRequired') });
      }

      const cachedResult = await this.propertyCache.getLeaseableProperties(cuid, fetchUnits);
      if (cachedResult.success && cachedResult.data) {
        this.log.info('Returning leaseable properties from cache', { cuid, fetchUnits });
        return {
          success: true,
          data: {
            items: cachedResult.data,
            metadata: {
              totalProperties: cachedResult.data.length,
              filteredCount: 0,
            },
          },
          message: t('property.success.propertiesRetrieved'),
        };
      }

      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        this.log.error(`Client with cuid ${cuid} not found`);
        throw new NotFoundError({ message: t('client.errors.notFound') });
      }

      const filter: FilterQuery<IPropertyDocument> = {
        cuid,
        deletedAt: null,
        status: 'available',
        approvalStatus: PropertyApprovalStatusEnum.APPROVED,
      };

      const properties = await this.propertyDAO.list(filter, {
        limit: 1000,
        sort: { name: 1 },
        projection: '_id name address propertyType fees',
      });

      if (!properties.items.length) {
        return {
          success: true,
          data: { items: [], metadata: null },
          message: t('property.success.propertiesRetrieved'),
        };
      }

      // Map properties to simplified format and filter multi-unit properties without units
      const leaseableProperties: any[] = [];
      const filteredProperties: Array<{
        id: string;
        name: string;
        propertyType: string;
        reason: string;
      }> = [];

      for (const property of properties.items) {
        const propertyObj = property.toObject ? property.toObject() : property;
        const isMultiUnit = PropertyTypeManager.supportsMultipleUnits(propertyObj.propertyType);

        // Check if multi-unit property has units
        if (isMultiUnit) {
          const unitsResult = await this.propertyUnitDAO.findAvailableUnits(
            propertyObj._id.toString()
          );

          // Filter out multi-unit properties with no units
          if (!unitsResult.items || unitsResult.items.length === 0) {
            filteredProperties.push({
              id: propertyObj._id.toString(),
              name: propertyObj.name,
              propertyType: propertyObj.propertyType,
              reason: 'requires_units',
            });
            this.log.debug(
              `Filtered out property ${propertyObj.name} - multi-unit property with no units`
            );
            continue; // Skip this property
          }
        }

        // Build leaseable property object
        const result: any = {
          id: propertyObj._id.toString(),
          name: propertyObj.name,
          address: propertyObj.address?.fullAddress || '',
          propertyType: propertyObj.propertyType,
        };

        // Add financial info if available
        if (propertyObj.fees) {
          result.financialInfo = {
            monthlyRent: propertyObj.fees.monthlyRent,
            securityDeposit: propertyObj.fees.securityDeposit,
            currency: propertyObj.fees.currency || 'USD',
          };
        }

        // Fetch and attach units if requested
        if (fetchUnits && isMultiUnit) {
          const unitsResult = await this.propertyUnitDAO.findAvailableUnits(
            propertyObj._id.toString()
          );

          if (unitsResult.items && unitsResult.items.length > 0) {
            result.units = unitsResult.items.map((unit) => {
              const unitObj = unit.toObject ? unit.toObject() : unit;
              const unitData: any = {
                id: unitObj._id.toString(),
                unitNumber: unitObj.unitNumber,
                status: unitObj.status,
              };

              // Add unit financial info if available (units can override property fees)
              if (unitObj.fees) {
                unitData.financialInfo = {
                  monthlyRent: unitObj.fees.monthlyRent,
                  securityDeposit: unitObj.fees.securityDeposit,
                  currency: unitObj.fees.currency || propertyObj.fees?.currency || 'USD',
                };
              } else if (propertyObj.fees) {
                // Use property fees as fallback
                unitData.financialInfo = {
                  monthlyRent: propertyObj.fees.monthlyRent,
                  securityDeposit: propertyObj.fees.securityDeposit,
                  currency: propertyObj.fees.currency || 'USD',
                };
              }

              return unitData;
            });
          }
        }

        leaseableProperties.push(result);
      }

      // Cache the result (5 minutes TTL)
      await this.propertyCache.cacheLeaseableProperties(cuid, fetchUnits, leaseableProperties);

      this.log.info(
        `Retrieved ${leaseableProperties.length} lease-able properties for client ${cuid}`,
        {
          fetchUnits,
          totalUnits: leaseableProperties.reduce((sum, p) => sum + (p.units?.length || 0), 0),
          filteredCount: filteredProperties.length,
          cached: true,
        }
      );

      return {
        success: true,
        data: {
          items: leaseableProperties,
          metadata: {
            totalProperties: properties.items.length,
            filteredCount: filteredProperties.length,
            filteredProperties: filteredProperties.length > 0 ? filteredProperties : undefined,
          },
        },
        message: t('property.success.propertiesRetrieved'),
      };
    } catch (error) {
      this.log.error('Failed to get lease-able properties', {
        cuid,
        fetchUnits,
        error: error.message,
      });
      throw error;
    }
  }

  async destroy(): Promise<void> {
    this.log.info(t('property.logging.cleaningUp'));

    // Remove all event listeners
    // Note: Upload event listeners are now managed by PropertyMediaService
    this.emitterService.off(EventTypes.UNIT_CREATED, this.handleUnitChanged);
    this.emitterService.off(EventTypes.UNIT_UPDATED, this.handleUnitChanged);
    this.emitterService.off(EventTypes.UNIT_ARCHIVED, this.handleUnitChanged);
    this.emitterService.off(EventTypes.UNIT_UNARCHIVED, this.handleUnitChanged);
    this.emitterService.off(EventTypes.UNIT_STATUS_CHANGED, this.handleUnitChanged);
    this.emitterService.off(EventTypes.UNIT_BATCH_CREATED, this.handleUnitBatchChanged);

    this.log.info(t('property.logging.eventListenersRemoved'));
  }
}
