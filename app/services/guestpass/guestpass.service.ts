import dayjs from 'dayjs';
import crypto from 'crypto';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { PropertyDAO } from '@dao/propertyDAO';
import { GuestPassDAO } from '@dao/guestpassDAO';
import { getRequestDuration } from '@utils/helpers';
import { PropertyUnitDAO, LeaseDAO } from '@dao/index';
import { EventTypes } from '@interfaces/events.interface';
import { ROLES } from '@shared/constants/roles.constants';
import { PropertyUnitStatusEnum, LeaseStatus } from '@interfaces/index';
import { EventEmitterService } from '@services/eventEmitter/eventsEmitter.service';
import { IPromiseReturnedData, IRequestContext } from '@interfaces/utils.interface';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import {
  IGuestPassListResponse,
  ICreateGuestPassInput,
  IGuestPassDocument,
  DeliveryStatusEnum,
  IGuestPassFilters,
  GuestPassStatus,
  IGuestPassStats,
  DeliveryMethod,
} from '@interfaces/guestPass.interface';

export class GuestPassService {
  private readonly log: Logger;
  private readonly leaseDAO: LeaseDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly guestPassDAO: GuestPassDAO;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly emitterService: EventEmitterService;

  constructor({
    leaseDAO,
    propertyDAO,
    guestPassDAO,
    propertyUnitDAO,
    emitterService,
  }: {
    leaseDAO: LeaseDAO;
    propertyDAO: PropertyDAO;
    guestPassDAO: GuestPassDAO;
    propertyUnitDAO: PropertyUnitDAO;
    emitterService: EventEmitterService;
  }) {
    this.leaseDAO = leaseDAO;
    this.propertyDAO = propertyDAO;
    this.guestPassDAO = guestPassDAO;
    this.propertyUnitDAO = propertyUnitDAO;
    this.emitterService = emitterService;
    this.log = createLogger('GuestPassService');
  }

  async createGuestPass(
    ctx: IRequestContext,
    data: ICreateGuestPassInput
  ): IPromiseReturnedData<IGuestPassDocument> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const start = process.hrtime.bigint();

    try {
      if (currentuser.client.role === ROLES.TENANT) {
        const activeLease = await this.leaseDAO.findFirst({
          cuid,
          tenantId: new Types.ObjectId(currentuser.sub),
          status: LeaseStatus.ACTIVE,
          deletedAt: null,
        });
        if (!activeLease) {
          throw new ForbiddenError({ message: t('maintenance.errors.noActiveLease') });
        }
      }

      const property = await this.propertyDAO.findFirst({
        pid: data.propertyInfo.pid,
        cuid,
        operationalStatus: { $ne: 'inactive' },
        deletedAt: null,
      });
      if (!property)
        throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Property' }) });

      let unit = null;
      if (data.propertyInfo.puid) {
        unit = await this.propertyUnitDAO.findFirst({
          puid: data.propertyInfo.puid,
          propertyId: property._id,
          isActive: true,
          status: { $ne: PropertyUnitStatusEnum.INACTIVE },
          deletedAt: null,
        });
        if (!unit)
          throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Unit' }) });
      }

      const code = await this.generateUniqueCode();
      const expiryMinutes = data.expiryMinutes || 15;
      const validUntil = dayjs().add(expiryMinutes, 'minute').toDate();

      const sentVia: DeliveryMethod[] = [];
      const deliveryStatus: Record<string, DeliveryStatusEnum> = {};
      if (data.sendViaEmail) {
        sentVia.push(DeliveryMethod.EMAIL);
        deliveryStatus[DeliveryMethod.EMAIL] = DeliveryStatusEnum.PENDING;
      }
      if (data.sendViaSms) {
        sentVia.push(DeliveryMethod.SMS);
        deliveryStatus[DeliveryMethod.SMS] = DeliveryStatusEnum.PENDING;
      }

      const session = await this.guestPassDAO.startSession();
      const { guestPass } = await this.guestPassDAO.withTransaction(session, async (session) => {
        const result = await this.guestPassDAO.insert(
          {
            cuid,
            code,
            propertyId: new Types.ObjectId(property._id),
            propertyUnitId: unit?._id ? new Types.ObjectId(unit._id) : undefined,
            visitorInfo: {
              name: data.visitorName,
              phone: data.visitorPhone,
              email: data.visitorEmail,
            },
            createdBy: new Types.ObjectId(currentuser.sub),
            validUntil,
            expiryMinutes,
            status: GuestPassStatus.ACTIVE,
            sentVia,
            deliveryStatus,
            isAcknowledged: false,
          },
          session
        );
        return { guestPass: result };
      });

      this.emitterService.emit(EventTypes.GUEST_PASS_CREATED, {
        cuid,
        vpuid: guestPass.vpuid,
        createdBy: currentuser.sub,
        visitorName: data.visitorName,
        propertyId: property._id.toString(),
      });

      this.log.info(
        {
          cuid,
          vpuid: guestPass.vpuid,
          userId: currentuser.sub,
          requestId: ctx.requestId,
          propertyId: property.pid,
          duration: getRequestDuration(start).durationInMs,
        },
        'Guest pass created'
      );

      return {
        success: true,
        data: guestPass,
        message: 'Access code generated and sent to visitor',
      };
    } catch (error) {
      this.log.error(
        {
          cuid,
          error,
          url: ctx.request.url,
          userId: currentuser.sub,
          requestId: ctx.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Error creating guest pass'
      );
      throw error;
    }
  }

  async getMyPasses(
    ctx: IRequestContext,
    filters: IGuestPassFilters
  ): IPromiseReturnedData<IGuestPassListResponse> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const start = process.hrtime.bigint();

    try {
      const page = filters.page || 1;
      const limit = filters.limit || 20;
      const skip = (page - 1) * limit;

      const query: any = { cuid };
      if (currentuser.client.role === ROLES.TENANT) {
        query.createdBy = new Types.ObjectId(currentuser.sub);
      }

      if (filters.status) query.status = filters.status;
      if (filters.propertyId) query.propertyId = new Types.ObjectId(filters.propertyId);

      const result = await this.guestPassDAO.list(query, {
        sort: { createdAt: -1 },
        limit,
        skip,
        populate: [
          { path: 'propertyId', select: 'name puid' },
          { path: 'propertyUnitId', select: 'puid unitNumber' },
          { path: 'createdBy', select: 'email uid' },
        ],
      });

      this.log.info(
        {
          cuid,
          userId: currentuser.sub,
          requestId: ctx.requestId,
          count: result.items.length,
          duration: getRequestDuration(start).durationInMs,
        },
        'Guest passes listed'
      );

      return {
        success: true,
        data: { passes: result.items, pagination: result.pagination },
      };
    } catch (error) {
      this.log.error(
        {
          cuid,
          error,
          url: ctx.request.url,
          userId: currentuser.sub,
          requestId: ctx.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Error listing passes'
      );
      throw error;
    }
  }

  async revokePass(ctx: IRequestContext, vpuid: string): IPromiseReturnedData<IGuestPassDocument> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const start = process.hrtime.bigint();

    try {
      const pass = await this.guestPassDAO.findFirst({ vpuid, cuid });
      if (!pass) {
        throw new NotFoundError({
          message: t('common.errors.notFound', { resource: 'Guest pass' }),
        });
      }

      if (
        currentuser.client.role === ROLES.TENANT &&
        pass.createdBy.toString() !== currentuser.sub
      ) {
        throw new ForbiddenError({ message: t('common.errors.forbidden') });
      }

      const isExpired =
        pass.status === GuestPassStatus.EXPIRED || dayjs().isAfter(dayjs(pass.validUntil));
      const isRevocable =
        [GuestPassStatus.PENDING, GuestPassStatus.ACTIVE].includes(pass.status) && !isExpired;
      if (!isRevocable) {
        throw new BadRequestError({
          message: `Cannot revoke a pass that is ${isExpired ? 'expired' : pass.status}`,
        });
      }

      const updated = await this.guestPassDAO.revokePass(
        pass._id.toString(),
        cuid,
        currentuser.sub
      );

      this.emitterService.emit(EventTypes.GUEST_PASS_REVOKED, {
        cuid,
        vpuid: pass.vpuid,
        revokedBy: currentuser.sub,
        revokedAt: new Date(),
      });

      this.log.info(
        {
          cuid,
          vpuid,
          userId: currentuser.sub,
          requestId: ctx.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Guest pass revoked'
      );

      return {
        success: true,
        data: updated!,
        message: 'Guest pass revoked successfully',
      };
    } catch (error) {
      this.log.error(
        {
          cuid,
          vpuid,
          error,
          url: ctx.request.url,
          userId: currentuser.sub,
          requestId: ctx.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Error revoking pass'
      );
      throw error;
    }
  }

  async getStats(ctx: IRequestContext, pid?: string): IPromiseReturnedData<IGuestPassStats> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const start = process.hrtime.bigint();

    try {
      let propertyId: string | string[] | undefined;
      let createdBy: string | undefined;

      if (pid) {
        const property = await this.propertyDAO.findFirst({
          pid,
          cuid,
          operationalStatus: { $ne: 'inactive' },
          deletedAt: null,
        });
        if (!property) {
          throw new NotFoundError({
            message: t('common.errors.notFound', { resource: 'Property' }),
          });
        }
        propertyId = property._id.toString();
      }

      const role = currentuser.client.role;
      if (role === ROLES.TENANT) {
        createdBy = currentuser.sub;
      } else if (role === ROLES.STAFF && !pid) {
        // Staff (e.g. security) only see stats for properties they're assigned to
        const assignedProperties = await this.propertyDAO.list(
          { cuid, assignedStaff: new Types.ObjectId(currentuser.sub), deletedAt: null },
          { projection: '_id' }
        );
        const ids = assignedProperties.items.map((p: any) => p._id.toString());
        if (ids.length > 0) {
          propertyId = ids;
        }
      }

      await this.guestPassDAO.expireOldPasses(cuid);
      const stats = await this.guestPassDAO.getStats(cuid, propertyId, createdBy);

      this.log.info(
        {
          cuid,
          pid,
          userId: currentuser.sub,
          requestId: ctx.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Guest pass stats retrieved'
      );
      return { success: true, data: stats };
    } catch (error) {
      this.log.error(
        {
          cuid,
          pid,
          userId: currentuser.sub,
          requestId: ctx.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Error getting stats'
      );
      throw error;
    }
  }

  private async generateUniqueCode(): Promise<string> {
    return crypto.randomInt(100000, 999999).toString();
  }
}
