import Logger from 'bunyan';
import { Types } from 'mongoose';
import { IUnit } from '@interfaces/unit.interface';
import { PropertyQueue } from '@queues/property.queue';
import { BadRequestError } from '@shared/customErrors';
import { PropertyCache } from '@caching/property.cache';
import { EventEmitterService } from '@services/eventEmitter';
import { IPaginationQuery, IRequestContext } from '@interfaces/utils.interface';
import { getRequestDuration, createLogger } from '@utils/index';
import { PropertyUnitDAO, PropertyDAO, ProfileDAO, ClientDAO } from '@dao/index';
import { IPropertyFilterQuery } from '@interfaces/property.interface';

interface IConstructor {
  emitterService: EventEmitterService;
  propertyUnitDAO: PropertyUnitDAO;
  propertyCache: PropertyCache;
  propertyQueue: PropertyQueue;
  propertyDAO: PropertyDAO;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
}
export class PropertyUnitService {
  private readonly log: Logger;
  private readonly clientDAO: ClientDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly propertyQueue: PropertyQueue;
  private readonly propertyCache: PropertyCache;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly emitterService: EventEmitterService;

  constructor({
    clientDAO,
    profileDAO,
    propertyDAO,
    propertyUnitDAO,
    propertyQueue,
    propertyCache,
    emitterService,
  }: IConstructor) {
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.propertyDAO = propertyDAO;
    this.propertyCache = propertyCache;
    this.propertyQueue = propertyQueue;
    this.emitterService = emitterService;
    this.propertyUnitDAO = propertyUnitDAO;
    this.log = createLogger('PropertyUnitService');
  }

  async addPropertyUnit(cxt: IRequestContext, data: IUnit) {
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
          url: request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Property not found, unable to add unit.'
      );
      throw new BadRequestError({ message: 'Unable to add unit to property, property not found.' });
    }

    const session = await this.propertyUnitDAO.startSession();
    const result = await this.propertyUnitDAO.withTransaction(session, async (session) => {
      const canAddUnit = await this.propertyDAO.canAddUnitToProperty(property.id);
      if (!canAddUnit.canAdd) {
        this.log.error(
          {
            cid,
            pid,
            url: request.url,
            userId: currentuser?.sub,
            requestId: cxt.requestId,
            duration: getRequestDuration(start).durationInMs,
          },
          'Property has reached maximum unit capacity.'
        );
        throw new BadRequestError({
          message: 'Unable to add unit to property, maximum capacity reached.',
        });
      }

      const newUnitData = {
        ...data,
        cid,
        propertyId: pid,
        createdBy: new Types.ObjectId(currentuser.sub),
        lastModifiedBy: new Types.ObjectId(currentuser.sub),
      };

      const unit = await this.propertyUnitDAO.insert(newUnitData, session);
      await this.propertyDAO.syncPropertyOccupancyWithUnits(pid, currentuser.sub);

      return {
        data: unit,
      };
    });
    await this.propertyCache.invalidateProperty(cid, pid);
    return {
      success: true,
      data: result.data,
      message: 'Unit added successfully',
    };
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

    const units = await this.propertyUnitDAO.findAll({ propertyId: property.id });

    return {
      data: units,
      success: true,
      message: 'Units retrieved successfully.',
    };
  }
}
