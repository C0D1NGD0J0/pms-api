import dayjs from 'dayjs';
import crypto from 'crypto';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { SmsQueue } from '@queues/sms.queue';
import { PropertyDAO } from '@dao/propertyDAO';
import { GuestPassDAO } from '@dao/guestpassDAO';
import { EmailQueue } from '@queues/email.queue';
import { getRequestDuration } from '@utils/helpers';
import { PropertyUnitDAO, LeaseDAO } from '@dao/index';
import { ROLES } from '@shared/constants/roles.constants';
import { SMSMessageType } from '@interfaces/sms.interface';
import { EventEmitterService } from '@services/eventEmitter/eventsEmitter.service';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import {
  PropertyUnitStatusEnum,
  IPromiseReturnedData,
  IRequestContext,
  LeaseStatus,
  EventTypes,
  MailType,
  ICronJob,
} from '@interfaces/index';
import {
  IGuestPassValidationResult,
  IValidateGuestPassRequest,
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
  private readonly smsQueue: SmsQueue;
  private readonly emailQueue: EmailQueue;
  private readonly propertyDAO: PropertyDAO;
  private readonly guestPassDAO: GuestPassDAO;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly emitterService: EventEmitterService;

  constructor({
    leaseDAO,
    smsQueue,
    emailQueue,
    propertyDAO,
    guestPassDAO,
    propertyUnitDAO,
    emitterService,
  }: {
    leaseDAO: LeaseDAO;
    smsQueue: SmsQueue;
    emailQueue: EmailQueue;
    propertyDAO: PropertyDAO;
    guestPassDAO: GuestPassDAO;
    propertyUnitDAO: PropertyUnitDAO;
    emitterService: EventEmitterService;
  }) {
    this.leaseDAO = leaseDAO;
    this.smsQueue = smsQueue;
    this.emailQueue = emailQueue;
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
      const property = await this.propertyDAO.findFirst({
        pid: data.propertyInfo.pid,
        cuid,
        operationalStatus: { $ne: 'inactive' },
        deletedAt: null,
      });
      if (!property)
        throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Property' }) });

      if (currentuser.client.role === ROLES.TENANT) {
        const activeLease = await this.leaseDAO.findFirst({
          cuid,
          tenantId: new Types.ObjectId(currentuser.sub),
          'property.id': property._id,
          status: LeaseStatus.ACTIVE,
          deletedAt: null,
        });
        if (!activeLease) {
          throw new ForbiddenError({ message: t('maintenance.errors.noActiveLease') });
        }
      }

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

      const code = await this.generateUniqueCode(cuid);
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

      // Enqueue delivery jobs
      if (data.sendViaSms && data.visitorPhone) {
        this.smsQueue.addToSmsQueue('guest-pass-code', {
          to: data.visitorPhone,
          body: `Your access code is: ${guestPass.code}. Valid for ${expiryMinutes} mins. Show to security at the gate.`,
          cuid,
          passId: guestPass._id.toString(),
          messageType: SMSMessageType.GUEST_PASS,
        });
      }

      if (data.sendViaEmail && data.visitorEmail) {
        this.emailQueue.addToEmailQueue('guest-pass-code', {
          to: data.visitorEmail,
          emailType: MailType.GUEST_PASS_CODE,
          subject: 'Your Visitor Access Code',
          data: {
            code: guestPass.code,
            visitorName: data.visitorName,
            expiryMinutes,
            propertyName: property.name,
          },
        });
      }

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
      } else if (currentuser.client.role === ROLES.STAFF) {
        // Staff only see passes for their assigned properties
        const assignedProperties = await this.propertyDAO.list(
          { cuid, assignedStaff: new Types.ObjectId(currentuser.sub), deletedAt: null },
          { projection: '_id' }
        );
        const assignedIds = assignedProperties.items.map((p: any) => p._id);
        if (assignedIds.length === 0) {
          return {
            success: true,
            data: {
              passes: [],
              pagination: {
                hasMoreResource: false,
                currentPage: 1,
                totalPages: 0,
                perPage: limit,
                total: 0,
              },
            },
          };
        }
        query.propertyId = { $in: assignedIds };
      }

      if (filters.status) query.status = filters.status;
      if (filters.propertyId) {
        // If staff, validate the requested property is in their assigned set
        if (currentuser.client.role === ROLES.STAFF && query.propertyId?.$in) {
          const requestedId = new Types.ObjectId(filters.propertyId);
          if (!query.propertyId.$in.some((id: any) => id.equals(requestedId))) {
            throw new ForbiddenError({ message: t('common.errors.forbidden') });
          }
        }
        query.propertyId = new Types.ObjectId(filters.propertyId);
      }

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
      } else if (role === ROLES.STAFF) {
        // Staff (e.g. security) only see stats for properties they're assigned to
        const assignedProperties = await this.propertyDAO.list(
          { cuid, assignedStaff: new Types.ObjectId(currentuser.sub), deletedAt: null },
          { projection: '_id' }
        );
        const assignedIds = assignedProperties.items.map((p: any) => p._id.toString());
        if (assignedIds.length === 0) {
          // Unassigned staff — return empty stats
          return {
            success: true,
            data: {
              total: 0,
              active: 0,
              expired: 0,
              revoked: 0,
              used: 0,
              unacknowledged: 0,
              pending: 0,
            },
          };
        }
        if (pid && propertyId) {
          // Verify the requested property is in their assigned set
          if (!assignedIds.includes(propertyId as string)) {
            throw new ForbiddenError({ message: t('common.errors.forbidden') });
          }
        } else {
          propertyId = assignedIds;
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

  async getCronJobs(): Promise<ICronJob[]> {
    return [
      {
        name: 'guestpass.expire-stale-passes',
        schedule: '*/15 * * * *', // every 15 minutes
        handler: this.expireStaleGuestPasses.bind(this),
        enabled: true,
        service: 'GuestPassService',
        description: 'Batch-expire guest passes where validUntil has passed',
        timeout: 60000,
      },
    ];
  }

  async validateCode(
    ctx: IRequestContext,
    data: IValidateGuestPassRequest
  ): IPromiseReturnedData<IGuestPassValidationResult> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const start = process.hrtime.bigint();

    try {
      const pass = await this.guestPassDAO.findByCode(data.code, cuid);

      if (!pass) {
        return {
          success: true,
          data: { valid: false, reason: 'Code not found or expired' },
        };
      }

      // Verify the code belongs to the requested property
      const property = await this.propertyDAO.findFirst({
        _id: pass.propertyId,
        pid: data.propertyId,
        cuid,
        deletedAt: null,
      });
      if (!property) {
        return {
          success: true,
          data: { valid: false, reason: 'Code is not valid for this property' },
        };
      }

      const updated = await this.guestPassDAO.markAsUsed(
        pass._id.toString(),
        cuid,
        currentuser.sub,
        data.entryNotes
      );

      this.emitterService.emit(EventTypes.GUEST_PASS_VALIDATED, {
        cuid,
        vpuid: pass.vpuid,
        validatedBy: currentuser.sub,
      });

      this.log.info(
        {
          cuid,
          vpuid: pass.vpuid,
          userId: currentuser.sub,
          requestId: ctx.requestId,
          propertyId: property.pid,
          duration: getRequestDuration(start).durationInMs,
        },
        'Guest pass validated'
      );

      return {
        success: true,
        data: { valid: true, pass: updated || pass },
        message: 'Code is valid. Visitor authorized to enter.',
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
        'Error validating code'
      );
      throw error;
    }
  }

  async getExpectedVisitors(
    ctx: IRequestContext,
    filters: IGuestPassFilters
  ): IPromiseReturnedData<IGuestPassListResponse> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const start = process.hrtime.bigint();

    try {
      const now = dayjs();
      const page = filters.page || 1;
      const limit = filters.limit || 20;
      const skip = (page - 1) * limit;

      const query: any = {
        cuid,
        status: { $in: [GuestPassStatus.ACTIVE, GuestPassStatus.PENDING] },
        validUntil: { $gt: now.toDate() },
      };

      if (currentuser.client.role === ROLES.TENANT) {
        query.createdBy = new Types.ObjectId(currentuser.sub);
      }

      if (currentuser.client.role === ROLES.STAFF) {
        const assignedProperties = await this.propertyDAO.list(
          { cuid, assignedStaff: new Types.ObjectId(currentuser.sub), deletedAt: null },
          { projection: '_id' }
        );
        const assignedIds = assignedProperties.items.map((p: any) => p._id);
        if (assignedIds.length === 0) {
          return {
            success: true,
            data: {
              passes: [],
              pagination: {
                hasMoreResource: false,
                currentPage: 1,
                totalPages: 0,
                perPage: limit,
                total: 0,
              },
            },
          };
        }
        if (filters.propertyId) {
          const requestedId = new Types.ObjectId(filters.propertyId);
          if (!assignedIds.some((id: any) => id.equals(requestedId))) {
            throw new ForbiddenError({ message: t('common.errors.forbidden') });
          }
          query.propertyId = requestedId;
        } else {
          query.propertyId = { $in: assignedIds };
        }
      } else if (filters.propertyId) {
        query.propertyId = new Types.ObjectId(filters.propertyId);
      }

      if (filters.timeWindow === 'next_hour') {
        query.validUntil = { $gt: now.toDate(), $lte: now.add(1, 'hour').toDate() };
      } else if (filters.timeWindow === 'today') {
        query.validUntil = { $gt: now.toDate(), $lte: now.endOf('day').toDate() };
      }

      const result = await this.guestPassDAO.list(query, {
        sort: { createdAt: -1 },
        limit,
        skip,
        populate: [
          { path: 'propertyId', select: 'name address puid' },
          { path: 'propertyUnitId', select: 'puid unitNumber floor' },
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
        'Expected visitors listed'
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
        'Error listing expected visitors'
      );
      throw error;
    }
  }

  async acknowledgePass(
    ctx: IRequestContext,
    passId: string
  ): IPromiseReturnedData<IGuestPassDocument> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const start = process.hrtime.bigint();

    try {
      const updated = await this.guestPassDAO.acknowledgePass(cuid, passId, currentuser.sub);
      if (!updated) {
        throw new BadRequestError({
          message: 'Pass not found, already acknowledged, or not active',
        });
      }

      this.emitterService.emit(EventTypes.GUEST_PASS_ACKNOWLEDGED, {
        cuid,
        vpuid: updated.vpuid,
        acknowledgedBy: currentuser.sub,
      });

      this.log.info(
        {
          cuid,
          passId,
          userId: currentuser.sub,
          requestId: ctx.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Guest pass acknowledged'
      );

      return {
        success: true,
        data: updated,
        message: 'Pass acknowledged successfully',
      };
    } catch (error) {
      this.log.error(
        {
          cuid,
          passId,
          error,
          url: ctx.request.url,
          userId: currentuser.sub,
          requestId: ctx.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Error acknowledging pass'
      );
      throw error;
    }
  }

  async bulkAcknowledgePasses(
    ctx: IRequestContext,
    passIds: string[]
  ): IPromiseReturnedData<{ acknowledged: number }> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const start = process.hrtime.bigint();

    try {
      const count = await this.guestPassDAO.bulkAcknowledge(cuid, passIds, currentuser.sub);

      this.log.info(
        {
          cuid,
          count,
          userId: currentuser.sub,
          requestId: ctx.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Guest passes bulk acknowledged'
      );

      return {
        success: true,
        data: { acknowledged: count },
        message: `${count} passes acknowledged`,
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
        'Error bulk acknowledging passes'
      );
      throw error;
    }
  }

  async getUnacknowledgedPasses(
    ctx: IRequestContext,
    propertyId: string
  ): IPromiseReturnedData<IGuestPassDocument[]> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const start = process.hrtime.bigint();

    try {
      const passes = await this.guestPassDAO.getUnacknowledgedPasses(cuid, propertyId);

      this.log.info(
        {
          cuid,
          propertyId,
          requestId: ctx.requestId,
          count: passes.length,
          duration: getRequestDuration(start).durationInMs,
        },
        'Unacknowledged passes retrieved'
      );

      return { success: true, data: passes };
    } catch (error) {
      this.log.error(
        {
          cuid,
          propertyId,
          error,
          url: ctx.request.url,
          userId: currentuser.sub,
          requestId: ctx.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Error getting unacknowledged passes'
      );
      throw error;
    }
  }

  async getUnacknowledgedCount(
    ctx: IRequestContext,
    propertyId?: string
  ): IPromiseReturnedData<{ count: number }> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const start = process.hrtime.bigint();

    try {
      const count = await this.guestPassDAO.getUnacknowledgedCount(cuid, propertyId);

      this.log.info(
        {
          cuid,
          propertyId,
          userId: currentuser.sub,
          requestId: ctx.requestId,
          count,
          duration: getRequestDuration(start).durationInMs,
        },
        'Unacknowledged count retrieved'
      );

      return { success: true, data: { count } };
    } catch (error) {
      this.log.error(
        {
          cuid,
          propertyId,
          error,
          url: ctx.request.url,
          userId: currentuser.sub,
          requestId: ctx.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        'Error getting unacknowledged count'
      );
      throw error;
    }
  }

  private async expireStaleGuestPasses(): Promise<void> {
    const start = process.hrtime.bigint();

    try {
      const stalePasses = await this.guestPassDAO.list(
        {
          status: { $in: [GuestPassStatus.ACTIVE, GuestPassStatus.PENDING] },
          validUntil: { $lte: new Date() },
        },
        { projection: 'vpuid cuid', limit: 1000 }
      );

      if (stalePasses.items.length === 0) {
        this.log.info('[Cron] No stale guest passes to expire');
        return;
      }

      const expiredCount = await this.guestPassDAO.expireOldPasses();

      this.emitterService.emit(EventTypes.GUEST_PASS_EXPIRED, {
        passes: stalePasses.items.map((p: any) => ({ cuid: p.cuid, vpuid: p.vpuid })),
        expiredAt: new Date(),
        count: expiredCount,
      });

      // Mark undelivered SMS/email as FAILED — update each channel independently
      // to avoid overwriting a successful delivery state on the other channel
      await Promise.all([
        this.guestPassDAO.updateMany(
          { status: GuestPassStatus.EXPIRED, 'deliveryStatus.sms': DeliveryStatusEnum.PENDING },
          { $set: { 'deliveryStatus.sms': DeliveryStatusEnum.FAILED } }
        ),
        this.guestPassDAO.updateMany(
          { status: GuestPassStatus.EXPIRED, 'deliveryStatus.email': DeliveryStatusEnum.PENDING },
          { $set: { 'deliveryStatus.email': DeliveryStatusEnum.FAILED } }
        ),
      ]);

      this.log.info(
        {
          expiredCount,
          duration: getRequestDuration(start).durationInMs,
        },
        '[Cron] Guest pass expiry complete'
      );
    } catch (error) {
      this.log.error(
        {
          error,
          duration: getRequestDuration(start).durationInMs,
        },
        '[Cron] Failed to expire guest passes'
      );
      throw error;
    }
  }

  private async generateUniqueCode(cuid: string, maxRetries = 5): Promise<string> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const code = crypto.randomInt(100000, 999999).toString();
      const existing = await this.guestPassDAO.findFirst({
        cuid,
        code,
        status: { $in: [GuestPassStatus.ACTIVE, GuestPassStatus.PENDING] },
      });
      if (!existing) return code;
    }
    throw new BadRequestError({
      message: 'Unable to generate unique guest pass code. Please try again.',
    });
  }
}
