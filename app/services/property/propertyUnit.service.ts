import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { PropertyQueue } from '@queues/property.queue';
import { PropertyCache } from '@caching/property.cache';
import { PropertyUnitCsvProcessor } from '@services/csv';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { PropertyUnitQueue } from '@queues/propertyUnit.queue';
import { getRequestDuration, createLogger } from '@utils/index';
import { IPropertyUnit } from '@interfaces/propertyUnit.interface';
import { ValidationRequestError, BadRequestError } from '@shared/customErrors';
import { PropertyUnitDAO, PropertyDAO, ProfileDAO, ClientDAO } from '@dao/index';
import { UnitNumberingService } from '@services/unitNumbering/unitNumbering.service';
import { IPropertyFilterQuery, IPropertyDocument } from '@interfaces/property.interface';
import { ExtractedMediaFile, IPaginationQuery, IRequestContext } from '@interfaces/utils.interface';

interface IConstructor {
  unitNumberingService: UnitNumberingService;
  propertyUnitQueue: PropertyUnitQueue;
  emitterService: EventEmitterService;
  propertyUnitDAO: PropertyUnitDAO;
  propertyCache: PropertyCache;
  propertyQueue: PropertyQueue;
  propertyDAO: PropertyDAO;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
}

interface BatchUnitData {
  units: IPropertyUnit[];
  cuid: string;
  pid: string;
}

export class PropertyUnitService {
  private readonly log: Logger;
  private readonly clientDAO: ClientDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly propertyQueue: PropertyQueue;
  private readonly propertyUnitQueue: PropertyUnitQueue;
  private readonly propertyCache: PropertyCache;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly emitterService: EventEmitterService;
  private readonly unitNumberingService: UnitNumberingService;

  constructor({
    clientDAO,
    profileDAO,
    propertyDAO,
    propertyUnitDAO,
    propertyQueue,
    propertyUnitQueue,
    propertyCache,
    emitterService,
    unitNumberingService,
  }: IConstructor) {
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.propertyDAO = propertyDAO;
    this.propertyCache = propertyCache;
    this.propertyQueue = propertyQueue;
    this.emitterService = emitterService;
    this.propertyUnitDAO = propertyUnitDAO;
    this.propertyUnitQueue = propertyUnitQueue;
    this.unitNumberingService = unitNumberingService;
    this.log = createLogger('PropertyUnitService');
  }

  async addPropertyUnit(cxt: IRequestContext, data: BatchUnitData) {
    const currentuser = cxt.currentuser!;
    const { cuid, pid } = cxt.request.params;
    const start = process.hrtime.bigint();

    if (!pid || !cuid) {
      this.log.error(
        {
          cuid,
          pid,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Property ID or Client ID is missing, unable to add unit.'
      );
      throw new BadRequestError({ message: t('propertyUnit.errors.unableToAddUnit') });
    }

    const property = await this.propertyDAO.findFirst({ pid, cuid, deletedAt: null });
    if (!property) {
      this.log.error(
        {
          cuid,
          pid,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Property not found, unable to add unit.'
      );
      throw new BadRequestError({ message: t('propertyUnit.errors.propertyNotFound') });
    }

    if (data.units.length <= 5) {
      return this.createUnitsDirectly(cxt, data, property);
    } else {
      return this.createUnitsViaQueue(cxt, data, currentuser.sub);
    }
  }

  async getPropertyUnit(cxt: IRequestContext) {
    const { request, currentuser } = cxt;
    const { cuid, pid, unitId } = request.params;
    const start = process.hrtime.bigint();
    if (!pid || !cuid || !unitId) {
      this.log.error(
        {
          cuid,
          pid,
          unitId,
          url: request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Property ID or Client ID or Unit ID is missing, unable to get unit.'
      );
      throw new BadRequestError({ message: t('propertyUnit.errors.unableToGetDetails') });
    }

    const property = await this.propertyDAO.findFirst({ pid, cuid, deletedAt: null });
    if (!property) {
      this.log.error(
        {
          cuid,
          pid,
          unitId,
          url: request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Property not found, unable to get unit.'
      );
      throw new BadRequestError({
        message: t('propertyUnit.errors.propertyNotFound'),
      });
    }

    const unit = await this.propertyUnitDAO.findFirst({ id: unitId, propertyId: property.id });
    if (!unit) {
      this.log.error(
        {
          cuid,
          pid,
          unitId,
          url: request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Unit not found in property.'
      );
      throw new BadRequestError({ message: t('propertyUnit.errors.unitNotFound') });
    }

    return {
      data: unit,
      success: true,
      message: t('propertyUnit.success.unitRetrieved'),
    };
  }

  async getPropertyUnits(cxt: IRequestContext, pagination: IPropertyFilterQuery['pagination']) {
    const { request, currentuser } = cxt;
    const { cuid, pid } = request.params;
    const start = process.hrtime.bigint();
    if (!pid || !cuid) {
      this.log.error(
        {
          cuid,
          pid,
          url: request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Property ID or Client ID is missing, unable to get units.'
      );
      throw new BadRequestError({ message: t('propertyUnit.errors.unableToGetUnits') });
    }

    const property = await this.propertyDAO.findFirst({ pid, cuid, deletedAt: null });
    if (!property) {
      this.log.error(
        {
          cuid,
          pid,
          url: request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Property not found, unable to get units.'
      );
      throw new BadRequestError({
        message: t('propertyUnit.errors.propertyNotFoundForUnits'),
      });
    }

    const opts: IPaginationQuery = {
      page: pagination.page,
      sort: pagination.sort,
      sortBy: pagination.sortBy,
      limit: Math.max(1, Math.min(pagination.limit || 10, 100)),
      skip: ((pagination.page || 1) - 1) * (pagination.limit || 10),
    };

    const units = await this.propertyDAO.getPropertyUnits(property.id, opts);
    return {
      data: units,
      success: true,
      message: t('propertyUnit.success.unitsRetrieved'),
    };
  }

  async updatePropertyUnit(cxt: IRequestContext, updateData: Partial<IPropertyUnit>) {
    const currentuser = cxt.currentuser!;
    const start = process.hrtime.bigint();
    const { cuid, pid, unitId } = cxt.request.params;

    if (!pid || !cuid || !unitId) {
      this.log.error(
        {
          cuid,
          pid,
          unitId,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Missing required parameters'
      );
      throw new BadRequestError({ message: t('propertyUnit.errors.unableToUpdate') });
    }

    const property = await this.propertyDAO.findFirst({ pid, cuid, deletedAt: null });
    if (!property) {
      this.log.error(
        {
          cuid,
          pid,
          unitId,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Property not found'
      );
      throw new BadRequestError({ message: t('propertyUnit.errors.propertyNotFound') });
    }

    const unit = await this.propertyUnitDAO.findFirst({
      id: unitId,
      deletedAt: null,
      propertyId: property.id,
    });

    if (!unit) {
      this.log.error(
        {
          cuid,
          pid,
          unitId,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Unit not found'
      );
      throw new BadRequestError({ message: t('propertyUnit.errors.unitNotFound') });
    }

    if (property.status === 'inactive' || property.deletedAt) {
      this.log.error(
        {
          cuid,
          pid,
          unitId,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Cannot update unit for inactive or archived property'
      );
      throw new BadRequestError({
        message: `Cannot update unit, due to property status of ${property.status}.`,
      });
    }

    const validationErrors: { [key: string]: string[] } = {};
    let unitNumberSuggestion: string | undefined;

    if (updateData.unitNumber || updateData.floor) {
      const newUnitNumber = updateData.unitNumber || unit.unitNumber;
      const newFloor = updateData.floor || unit.floor || 1;

      const existingUnits = await this.propertyDAO.getPropertyUnits(property.id, {
        limit: 1000,
        skip: 0,
        page: 1,
      });
      const unitFormValues = existingUnits.items.map((u: any) => ({
        unitNumber: u.unitNumber,
        unitType: u.unitType,
        floor: u.floor || 1,
      }));

      const validation = this.unitNumberingService.validateUnitNumberUpdate(
        newUnitNumber,
        newFloor,
        unitFormValues,
        unitId
      );

      if (!validation.isValid) {
        if (!validationErrors['unitNumber']) validationErrors['unitNumber'] = [];
        validationErrors['unitNumber'].push(validation.message);
        if (validation.suggestion) {
          unitNumberSuggestion = validation.suggestion;
        }
      }
    }

    if (updateData.fees) {
      if (updateData.fees.rentAmount !== undefined) {
        if (isNaN(updateData.fees.rentAmount) || updateData.fees.rentAmount < 0) {
          if (!validationErrors['fees.rentAmount']) validationErrors['fees.rentAmount'] = [];
          validationErrors['fees.rentAmount'].push('Rental amount must be a non-negative number');
        }
      }

      if (updateData.fees.securityDeposit !== undefined) {
        if (isNaN(updateData.fees.securityDeposit) || updateData.fees.securityDeposit < 0) {
          if (!validationErrors['fees.securityDeposit'])
            validationErrors['fees.securityDeposit'] = [];
          validationErrors['fees.securityDeposit'].push(
            'Security deposit must be a non-negative number'
          );
        }
      }
    }

    if (updateData.status) {
      if (updateData.status === 'occupied' && property.status !== 'available') {
        if (!validationErrors['status']) validationErrors['status'] = [];
        validationErrors['status'].push(
          `Cannot set unit as occupied when property is ${property.status}`
        );
      }

      if (
        updateData.status === 'occupied' &&
        !unit.fees?.rentAmount &&
        (!updateData.fees || updateData.fees.rentAmount === undefined)
      ) {
        if (!validationErrors['status']) validationErrors['status'] = [];
        validationErrors['status'].push('Occupied units must have a rental amount');
      }
    }

    if (Object.keys(validationErrors).length > 0) {
      // add suggestion to error message if available
      if (unitNumberSuggestion && validationErrors['unitNumber']) {
        validationErrors['unitNumber'].push(`Suggested unit number: ${unitNumberSuggestion}`);
      }

      throw new ValidationRequestError({
        message: t('propertyUnit.errors.validationFailed'),
        errorInfo: validationErrors,
      });
    }

    const session = await this.propertyUnitDAO.startSession();
    const result = await this.propertyUnitDAO.withTransaction(session, async (session) => {
      const updatedUnit = await this.propertyUnitDAO.update(
        { id: unitId, propertyId: property.id },
        {
          ...updateData,
          lastModifiedBy: new Types.ObjectId(currentuser.sub),
        },
        session
      );

      // Emit event for property occupancy sync if status changed
      if (updateData.status) {
        this.emitterService.emit(EventTypes.UNIT_STATUS_CHANGED, {
          propertyId: property.id,
          propertyPid: pid,
          cuid,
          unitId,
          userId: currentuser.sub,
          changeType: 'status_changed',
          previousStatus: unit.status,
          newStatus: updateData.status,
        });
      } else {
        // Emit general unit updated event
        this.emitterService.emit(EventTypes.UNIT_UPDATED, {
          propertyId: property.id,
          propertyPid: pid,
          cuid,
          unitId,
          userId: currentuser.sub,
          changeType: 'updated',
        });
      }

      return { data: updatedUnit };
    });
    await this.propertyCache.invalidateProperty(cuid, pid);
    await this.propertyCache.invalidatePropertyLists(cuid);

    return {
      success: true,
      data: result.data,
      message: t('propertyUnit.success.updated'),
    };
  }

  async updateUnitStatus(cxt: IRequestContext, updateData: any) {
    return this.updatePropertyUnit(cxt, updateData);
  }

  async archiveUnit(cxt: IRequestContext) {
    const currentuser = cxt.currentuser!;
    const { cuid, pid, unitId } = cxt.request.params;

    // Get property info for event emission
    const property = await this.propertyDAO.findFirst({ pid, cuid, deletedAt: null });
    if (!property) {
      throw new BadRequestError({ message: t('propertyUnit.errors.propertyNotFound') });
    }

    const updateData = {
      deletedAt: new Date(),
      lastModifiedBy: new Types.ObjectId(currentuser.sub),
    };

    const result = await this.updatePropertyUnit(cxt, updateData);

    // Emit unit archived event for property occupancy sync
    if (result.success) {
      this.emitterService.emit(EventTypes.UNIT_ARCHIVED, {
        propertyId: property.id,
        propertyPid: pid,
        cuid,
        unitId,
        userId: currentuser.sub,
        changeType: 'archived',
      });
    }

    return result;
  }

  async setupInspection(cxt: IRequestContext, inspectionData: any) {
    const currentuser = cxt.currentuser!;
    const updateData = {
      inspections: [inspectionData],
      lastModifiedBy: new Types.ObjectId(currentuser.sub),
    };
    return this.updatePropertyUnit(cxt, updateData);
  }

  async addDocumentToUnit(cxt: IRequestContext, documentData: any) {
    const currentuser = cxt.currentuser!;
    const updateData = {
      documents: [documentData],
      lastModifiedBy: new Types.ObjectId(currentuser.sub),
    };
    return this.updatePropertyUnit(cxt, updateData);
  }

  async deleteDocumentFromUnit(_cxt: IRequestContext) {
    return {
      success: true,
      message: t('propertyUnit.errors.documentDeletionNotImplemented'),
    };
  }

  private async createUnitsDirectly(
    cxt: IRequestContext,
    data: BatchUnitData,
    property: IPropertyDocument
  ) {
    const currentuser = cxt.currentuser!;
    const { cuid, pid } = cxt.request.params;
    const start = process.hrtime.bigint();

    const session = await this.propertyUnitDAO.startSession();
    const result = await this.propertyUnitDAO.withTransaction(session, async (session) => {
      const canAddUnits = await this.propertyDAO.canAddUnitToProperty(property.id);
      if (!canAddUnits.canAdd) {
        this.log.error(
          {
            cuid,
            pid,
            url: cxt.request.url,
            userId: currentuser?.sub,
            requestId: cxt.requestId,
            duration: getRequestDuration(start).durationInMs,
          },
          'Property has reached maximum unit capacity.'
        );
        throw new BadRequestError({
          message: t('propertyUnit.errors.maxCapacityReached'),
        });
      }

      // checks to see if adding the batch would exceed the limit
      if (
        canAddUnits.maxCapacity > 0 &&
        canAddUnits.currentCount + data.units.length > canAddUnits.maxCapacity
      ) {
        this.log.error(
          {
            cuid,
            pid,
            url: cxt.request.url,
            userId: currentuser?.sub,
            requestId: cxt.requestId,
            duration: getRequestDuration(start).durationInMs,
            currentCount: canAddUnits.currentCount,
            maxCapacity: canAddUnits.maxCapacity,
            unitsToAdd: data.units.length,
          },
          'Adding this batch would exceed maximum unit capacity.'
        );
        throw new BadRequestError({
          message: `Cannot add ${data.units.length} units. Property has ${canAddUnits.currentCount}/${canAddUnits.maxCapacity} units (including archived). Adding these units would exceed the limit.`,
        });
      }

      const existingUnits = await this.propertyDAO.getPropertyUnits(property.id, {
        limit: 1000,
        skip: 0,
        page: 1,
      });
      const unitFormValues = existingUnits.items.map((u: any) => ({
        unitNumber: u.unitNumber,
        unitType: u.unitType,
        floor: u.floor || 1,
      }));

      const createdUnits = [];
      const errors: any = {};

      for (let i = 0; i < data.units.length; i++) {
        const unit = data.units[i];
        try {
          const validation = this.unitNumberingService.validateUnitNumberUpdate(
            unit.unitNumber,
            unit.floor || 1,
            unitFormValues
          );

          if (!validation.isValid) {
            const errorMessage = validation.suggestion
              ? `${validation.message}. Suggested: ${validation.suggestion}`
              : validation.message;

            errors[`unit-${unit.unitNumber}`] = {
              unitNumber: unit.unitNumber,
              error: errorMessage,
            };
            continue;
          }

          const newUnitData = {
            ...unit,
            cuid,
            propertyId: new Types.ObjectId(property.id),
            createdBy: new Types.ObjectId(currentuser.sub),
            lastModifiedBy: new Types.ObjectId(currentuser.sub),
          };

          const createdUnit = await this.propertyUnitDAO.insert(newUnitData, session);
          createdUnits.push(createdUnit);

          unitFormValues.push({
            unitNumber: unit.unitNumber,
            unitType: unit.unitType,
            floor: unit.floor || 1,
          });
        } catch (error: any) {
          errors[`unit-${unit.unitNumber}`] = {
            unitNumber: unit.unitNumber,
            error: error.message || 'Failed to create unit',
          };
        }
      }

      if (Object.keys(errors).length > 0) {
        this.log.error('Some units could not be created.', {
          cuid,
          pid,
          error: errors,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        });
      }

      if (createdUnits.length > 0) {
        // Emit batch unit creation event for property occupancy sync
        this.emitterService.emit(EventTypes.UNIT_BATCH_CREATED, {
          propertyId: property.id,
          propertyPid: pid,
          cuid,
          userId: currentuser.sub,
          unitsCreated: createdUnits.length,
          unitsFailed: Object.keys(errors).length,
        });
      }

      return { createdUnits, errors };
    });

    await this.propertyCache.invalidateProperty(cuid, pid);
    const errorsArray = Object.keys(result.errors);
    return {
      success: true,
      data: result.createdUnits,
      errors: result.errors,
      message:
        errorsArray.length > 0
          ? `${result.createdUnits.length} units created successfully, ${errorsArray.length} failed`
          : `All ${result.createdUnits.length} units created successfully`,
      maxAllowedUnits: data.units.length,
    };
  }

  private async createUnitsViaQueue(cxt: IRequestContext, data: BatchUnitData, userId: string) {
    const jobId = await this.propertyUnitQueue.addUnitBatchCreationJob({
      units: data.units,
      pid: data.pid,
      cuid: data.cuid,
      userId: userId,
      requestId: cxt.requestId,
    });

    return {
      success: true,
      data: { jobId: jobId.toString() },
      message: t('propertyUnit.success.jobQueued'),
    };
  }

  async validateUnitsCsv(cxt: IRequestContext, csvFile: ExtractedMediaFile) {
    const currentuser = cxt.currentuser!;
    const { cuid, pid } = cxt.request.params;
    const start = process.hrtime.bigint();

    if (!csvFile) {
      throw new BadRequestError({ message: t('propertyUnit.errors.noCsvUploaded') });
    }

    if (csvFile.fileSize > 10 * 1024 * 1024) {
      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFile.path]);
      throw new BadRequestError({ message: t('propertyUnit.errors.fileTooLarge') });
    }

    // Validate property exists
    const property = await this.propertyDAO.findFirst({ pid, cuid, deletedAt: null });
    if (!property) {
      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFile.path]);
      throw new BadRequestError({ message: t('propertyUnit.errors.propertyNotFound') });
    }

    const csvProcessor = new PropertyUnitCsvProcessor();

    try {
      const validationResult = await csvProcessor.validateCsv(csvFile.path, {
        userId: currentuser.sub,
        cuid,
        pid: property.id,
      });

      // Clean up the file after processing
      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFile.path]);

      return {
        success: true,
        data: {
          validUnits: validationResult.validUnits.length,
          totalRows: validationResult.totalRows,
          errors: validationResult.errors,
        },
        message: t('propertyUnit.success.csvValidated'),
      };
    } catch (error: any) {
      this.log.error('CSV validation failed', {
        cuid,
        pid,
        error: error.message,
        url: cxt.request.url,
        userId: currentuser?.sub,
        requestId: cxt.requestId,
        duration: getRequestDuration(start).durationInMs,
      });

      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFile.path]);
      throw new BadRequestError({
        message: error.message || t('propertyUnit.errors.csvValidationFailed'),
      });
    }
  }

  async importUnitsFromCsv(cxt: IRequestContext, csvFile: ExtractedMediaFile) {
    const currentuser = cxt.currentuser!;
    const { cuid, pid } = cxt.request.params;
    const start = process.hrtime.bigint();

    if (!csvFile) {
      throw new BadRequestError({ message: t('propertyUnit.errors.noCsvUploaded') });
    }

    if (csvFile.fileSize > 10 * 1024 * 1024) {
      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFile.path]);
      throw new BadRequestError({ message: t('propertyUnit.errors.fileTooLarge') });
    }

    // Validate property exists
    const property = await this.propertyDAO.findFirst({ pid, cuid, deletedAt: null });
    if (!property) {
      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFile.path]);
      throw new BadRequestError({ message: t('propertyUnit.errors.propertyNotFound') });
    }

    const csvProcessor = new PropertyUnitCsvProcessor();

    try {
      const validationResult = await csvProcessor.validateCsv(csvFile.path, {
        userId: currentuser.sub,
        cuid,
        pid: property.id,
      });

      if (validationResult.errors && validationResult.errors.length > 0) {
        this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFile.path]);
        return {
          success: false,
          message: t('propertyUnit.errors.csvValidationFailed'),
          errors: validationResult.errors,
        };
      }

      // Create units using the existing batch creation logic
      const batchData: BatchUnitData = {
        units: validationResult.validUnits,
        cuid,
        pid,
      };

      const result = await this.createUnitsDirectly(cxt, batchData, property);

      // Clean up the file after processing
      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFile.path]);

      return {
        success: true,
        data: result.data,
        errors: result.errors,
        message: t('propertyUnit.success.csvImported'),
      };
    } catch (error: any) {
      this.log.error('CSV import failed', {
        cuid,
        pid,
        error: error.message,
        url: cxt.request.url,
        userId: currentuser?.sub,
        requestId: cxt.requestId,
        duration: getRequestDuration(start).durationInMs,
      });

      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFile.path]);
      throw new BadRequestError({
        message: error.message || t('propertyUnit.errors.csvImportFailed'),
      });
    }
  }
}
