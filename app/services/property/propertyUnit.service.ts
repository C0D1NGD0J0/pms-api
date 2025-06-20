import Logger from 'bunyan';
import { Types } from 'mongoose';
import { JobTracker } from '@caching/jobTracker';
import { PropertyQueue } from '@queues/property.queue';
import { PropertyCache } from '@caching/property.cache';
import { EventEmitterService } from '@services/eventEmitter';
import { PropertyUnitQueue } from '@queues/propertyUnit.queue';
import { getRequestDuration, createLogger } from '@utils/index';
import { IPropertyUnit } from '@interfaces/propertyUnit.interface';
import { ValidationRequestError, BadRequestError } from '@shared/customErrors';
import { IPaginationQuery, IRequestContext } from '@interfaces/utils.interface';
import { PropertyUnitDAO, PropertyDAO, ProfileDAO, ClientDAO } from '@dao/index';
import { UnitNumberingService } from '@services/unitNumbering/unitNumbering.service';
import { IPropertyFilterQuery, IPropertyDocument } from '@interfaces/property.interface';

interface IConstructor {
  unitNumberingService: UnitNumberingService;
  propertyUnitQueue: PropertyUnitQueue;
  emitterService: EventEmitterService;
  propertyUnitDAO: PropertyUnitDAO;
  propertyCache: PropertyCache;
  propertyQueue: PropertyQueue;
  propertyDAO: PropertyDAO;
  profileDAO: ProfileDAO;
  jobTracker: JobTracker;
  clientDAO: ClientDAO;
}

interface BatchUnitData {
  units: IPropertyUnit[];
  pid: string;
  cid: string;
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
  private readonly jobTracker: JobTracker;
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
    jobTracker,
    unitNumberingService,
  }: IConstructor) {
    this.jobTracker = jobTracker;
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
    const { cid, pid } = cxt.request.params;
    const start = process.hrtime.bigint();

    if (!pid || !cid) {
      this.log.error(
        {
          cid,
          pid,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Property ID or Client ID is missing, unable to add unit.'
      );
      throw new BadRequestError({ message: 'Unable to add unit to property.' });
    }

    const property = await this.propertyDAO.findFirst({ pid, cid, deletedAt: null });
    if (!property) {
      this.log.error(
        {
          cid,
          pid,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Property not found, unable to add unit.'
      );
      throw new BadRequestError({ message: 'Unable to add unit to property, property not found.' });
    }

    if (data.units.length <= 5) {
      return this.createUnitsDirectly(cxt, data, property);
    } else {
      return this.createUnitsViaQueue(cxt, data, currentuser.sub);
    }
  }

  async getJobStatus(jobId: string) {
    return this.propertyUnitQueue.getJobStatus(jobId);
  }

  async getUserJobs(userId: string) {
    const result = await this.jobTracker.getUserJobs(userId);

    if (!result.success) {
      return [];
    }

    const enhancedJobs = await Promise.all(
      result.data.map(async (job) => {
        const queueStatus = await this.propertyUnitQueue.getJobStatus(job.jobId);
        return {
          ...job,
          ...queueStatus,
        };
      })
    );

    const completedJobIds = enhancedJobs
      .filter((job: any) => job.state === 'completed' || job.state === 'failed')
      .map((job: any) => job.jobId);

    if (completedJobIds.length > 0) {
      await this.jobTracker.removeCompletedJobs(userId, completedJobIds);
    }

    return enhancedJobs.filter((job: any) => job.state !== 'completed' && job.state !== 'failed');
  }

  async getPropertyUnit(cxt: IRequestContext) {
    const { request, currentuser } = cxt;
    const { cid, pid, unitId } = request.params;
    const start = process.hrtime.bigint();
    if (!pid || !cid || !unitId) {
      this.log.error(
        {
          cid,
          pid,
          unitId,
          url: request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Property ID or Client ID or Unit ID is missing, unable to get unit.'
      );
      throw new BadRequestError({ message: 'Unable to get property unit details.' });
    }

    const property = await this.propertyDAO.findFirst({ pid, cid, deletedAt: null });
    if (!property) {
      this.log.error(
        {
          cid,
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
        message: 'Unable to get unit from property, property not found.',
      });
    }

    const unit = await this.propertyUnitDAO.findFirst({ id: unitId, propertyId: property.id });
    if (!unit) {
      this.log.error(
        {
          cid,
          pid,
          unitId,
          url: request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Unit not found in property.'
      );
      throw new BadRequestError({ message: 'Unable to get unit from property, unit not found.' });
    }

    return {
      data: unit,
      success: true,
      message: 'Unit retrieved successfully.',
    };
  }

  async getPropertyUnits(cxt: IRequestContext, pagination: IPropertyFilterQuery['pagination']) {
    const { request, currentuser } = cxt;
    const { cid, pid } = request.params;
    const start = process.hrtime.bigint();
    if (!pid || !cid) {
      this.log.error(
        {
          cid,
          pid,
          url: request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Property ID or Client ID is missing, unable to get units.'
      );
      throw new BadRequestError({ message: 'Unable to get property units.' });
    }

    const property = await this.propertyDAO.findFirst({ pid, cid, deletedAt: null });
    if (!property) {
      this.log.error(
        {
          cid,
          pid,
          url: request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Property not found, unable to get units.'
      );
      throw new BadRequestError({
        message: 'Unable to get units from property, property not found.',
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
      message: 'Units retrieved successfully.',
    };
  }

  async updatePropertyUnit(cxt: IRequestContext, updateData: Partial<IPropertyUnit>) {
    const currentuser = cxt.currentuser!;
    const start = process.hrtime.bigint();
    const { cid, pid, unitId } = cxt.request.params;

    if (!pid || !cid || !unitId) {
      this.log.error(
        {
          cid,
          pid,
          unitId,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Missing required parameters'
      );
      throw new BadRequestError({ message: 'Unable to update property unit.' });
    }

    const property = await this.propertyDAO.findFirst({ pid, cid, deletedAt: null });
    if (!property) {
      this.log.error(
        {
          cid,
          pid,
          unitId,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Property not found'
      );
      throw new BadRequestError({ message: 'Property not found.' });
    }

    const unit = await this.propertyUnitDAO.findFirst({
      id: unitId,
      deletedAt: null,
      propertyId: property.id,
    });

    if (!unit) {
      this.log.error(
        {
          cid,
          pid,
          unitId,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Unit not found'
      );
      throw new BadRequestError({ message: 'Unit not found.' });
    }

    if (property.status === 'inactive' || property.deletedAt) {
      this.log.error(
        {
          cid,
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
        message: 'Validation failed',
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

      if (updateData.status) {
        await this.propertyDAO.syncPropertyOccupancyWithUnits(pid, currentuser.sub);
      }

      return { data: updatedUnit };
    });
    await this.propertyCache.invalidateProperty(cid, pid);
    await this.propertyCache.invalidatePropertyLists(cid);

    return {
      success: true,
      data: result.data,
      message: 'Unit updated successfully',
    };
  }

  async updateUnitStatus(cxt: IRequestContext, updateData: any) {
    return this.updatePropertyUnit(cxt, updateData);
  }

  async archiveUnit(cxt: IRequestContext) {
    const currentuser = cxt.currentuser!;
    const updateData = {
      deletedAt: new Date(),
      lastModifiedBy: new Types.ObjectId(currentuser.sub),
    };
    return this.updatePropertyUnit(cxt, updateData);
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
      message: 'Document deletion functionality needs to be implemented',
    };
  }

  private async createUnitsDirectly(
    cxt: IRequestContext,
    data: BatchUnitData,
    property: IPropertyDocument
  ) {
    const currentuser = cxt.currentuser!;
    const { cid, pid } = cxt.request.params;
    const start = process.hrtime.bigint();

    const session = await this.propertyUnitDAO.startSession();
    const result = await this.propertyUnitDAO.withTransaction(session, async (session) => {
      const canAddUnits = await this.propertyDAO.canAddUnitToProperty(property.id);
      if (!canAddUnits.canAdd) {
        this.log.error(
          {
            cid,
            pid,
            url: cxt.request.url,
            userId: currentuser?.sub,
            requestId: cxt.requestId,
            duration: getRequestDuration(start).durationInMs,
          },
          'Property has reached maximum unit capacity.'
        );
        throw new BadRequestError({
          message: 'Unable to add units to property, maximum capacity reached.',
        });
      }

      // Get existing units for validation
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
            cid,
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
          cid,
          pid,
          error: errors,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        });
      }

      if (createdUnits.length > 0) {
        await this.propertyDAO.syncPropertyOccupancyWithUnits(property.id, currentuser.sub);
      }

      return { createdUnits, errors };
    });

    await this.propertyCache.invalidateProperty(cid, pid);
    const errorsArray = Object.keys(result.errors);
    return {
      success: true,
      data: result.createdUnits,
      errors: result.errors,
      message:
        errorsArray.length > 0
          ? `${result.createdUnits.length} units created successfully, ${errorsArray.length} failed`
          : `All ${result.createdUnits.length} units created successfully`,
      totalUnits: data.units.length,
    };
  }

  private async createUnitsViaQueue(cxt: IRequestContext, data: BatchUnitData, userId: string) {
    const jobId = await this.propertyUnitQueue.addUnitBatchCreationJob({
      units: data.units,
      pid: data.pid,
      cid: data.cid,
      userId: userId,
      requestId: cxt.requestId,
    });

    await this.jobTracker.trackJob(userId, jobId.toString(), 'unit_batch_creation', {
      pid: data.pid,
      cid: data.cid,
      unitCount: data.units.length,
    });

    return {
      success: true,
      jobId: jobId.toString(),
      message: 'Unit creation job queued successfully',
      estimatedCompletion: '2-3 minutes',
      totalUnits: data.units.length,
      processingType: 'queued',
    };
  }
}
