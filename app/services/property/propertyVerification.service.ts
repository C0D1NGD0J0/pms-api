import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { PropertyDAO } from '@dao/index';
import { PropertyCache } from '@caching/index';
import { ICurrentUser } from '@interfaces/user.interface';
import { VerificationStatusEnum, IPropertyDocument } from '@interfaces/property.interface';
import { InvalidRequestError, BadRequestError, NotFoundError } from '@shared/customErrors';
import { PROPERTY_VERIFICATION_ROLES, convertUserRoleToEnum, createLogger } from '@utils/index';
import { ISuccessReturnData, IPaginationQuery, IPaginateResult } from '@interfaces/utils.interface';

interface IConstructor {
  propertyCache: PropertyCache;
  propertyDAO: PropertyDAO;
}

export class PropertyVerificationService {
  private readonly log: Logger;
  private readonly propertyDAO: PropertyDAO;
  private readonly propertyCache: PropertyCache;

  constructor({ propertyDAO, propertyCache }: IConstructor) {
    this.propertyDAO = propertyDAO;
    this.propertyCache = propertyCache;
    this.log = createLogger('PropertyVerificationService');
  }

  private assertCanVerify(currentuser: ICurrentUser): void {
    const userRole = currentuser.client.role;
    if (!PROPERTY_VERIFICATION_ROLES.includes(convertUserRoleToEnum(userRole))) {
      throw new InvalidRequestError({
        message: t('common.errors.insufficientPermissions'),
      });
    }
  }

  private async findPropertyOrThrow(cuid: string, pid: string): Promise<IPropertyDocument> {
    const property = await this.propertyDAO.findFirst(
      { pid, cuid, deletedAt: null },
      { select: '+verificationGracePeriod +verificationDetails +owner' }
    );

    if (!property) {
      throw new NotFoundError({
        message: t('common.errors.notFound', { resource: 'Property' }),
      });
    }

    return property;
  }

  async getPendingVerifications(
    cuid: string,
    currentuser: ICurrentUser,
    pagination: IPaginationQuery
  ): Promise<ISuccessReturnData<{ items: IPropertyDocument[]; pagination?: IPaginateResult }>> {
    this.assertCanVerify(currentuser);

    const opts: IPaginationQuery = {
      page: pagination.page || 1,
      limit: Math.max(1, Math.min(pagination.limit || 10, 100)),
      sort: pagination.sort || '-createdAt',
      sortBy: pagination.sortBy || 'createdAt',
      skip: ((pagination.page || 1) - 1) * (pagination.limit || 10),
    };

    const properties = await this.propertyDAO.getPropertiesByClientId(
      cuid,
      {
        cuid,
        deletedAt: null,
        verificationStatus: VerificationStatusEnum.UNVERIFIED,
      },
      opts
    );

    return {
      success: true,
      data: {
        items: properties.items,
        pagination: properties.pagination,
      },
      message: t('common.success.retrieved', { resource: 'Pending verifications' }),
    };
  }

  async verifyProperty(
    cuid: string,
    pid: string,
    currentuser: ICurrentUser,
    notes?: string
  ): Promise<ISuccessReturnData> {
    this.assertCanVerify(currentuser);

    const property = await this.findPropertyOrThrow(cuid, pid);

    if (property.verificationStatus === VerificationStatusEnum.VERIFIED) {
      throw new InvalidRequestError({ message: 'Property is already verified.' });
    }

    const verificationEntry = {
      action: 'verified' as const,
      actor: new Types.ObjectId(currentuser.sub),
      timestamp: new Date(),
      ...(notes && { notes }),
    };

    const updateData: Record<string, any> = {
      $set: {
        verificationStatus: VerificationStatusEnum.VERIFIED,
        lastModifiedBy: new Types.ObjectId(currentuser.sub),
      },
      $push: { verificationDetails: verificationEntry },
    };

    const updated = await this.propertyDAO.update({ pid, cuid, deletedAt: null }, updateData);

    if (!updated) {
      throw new BadRequestError({
        message: t('common.errors.operationFailed', { action: 'verify property' }),
      });
    }

    await this.propertyCache.invalidateProperty(cuid, property.id);
    await this.propertyCache.invalidatePropertyLists(cuid);
    await this.propertyCache.invalidateLeaseableProperties(cuid);

    this.log.info('Property verified', { pid, verifiedBy: currentuser.sub });

    return {
      success: true,
      data: updated,
      message: 'Property verified successfully. Leases and payments are now enabled.',
    };
  }

  async rejectVerification(
    cuid: string,
    pid: string,
    currentuser: ICurrentUser,
    reason: string
  ): Promise<ISuccessReturnData> {
    if (!reason?.trim()) {
      throw new BadRequestError({
        message: t('common.errors.required', { field: 'Rejection reason' }),
      });
    }

    this.assertCanVerify(currentuser);

    const property = await this.findPropertyOrThrow(cuid, pid);

    const rejectionEntry = {
      action: 'rejected' as const,
      actor: new Types.ObjectId(currentuser.sub),
      timestamp: new Date(),
      rejectionReason: reason.trim(),
    };

    const updated = await this.propertyDAO.update(
      { pid, cuid, deletedAt: null },
      {
        $set: {
          verificationStatus: VerificationStatusEnum.REJECTED,
          lastModifiedBy: new Types.ObjectId(currentuser.sub),
        },
        $push: { verificationDetails: rejectionEntry },
      }
    );

    if (!updated) {
      throw new BadRequestError({
        message: t('common.errors.operationFailed', { action: 'reject verification' }),
      });
    }

    await this.propertyCache.invalidateProperty(cuid, property.id);
    await this.propertyCache.invalidatePropertyLists(cuid);

    this.log.info('Property verification rejected', { pid, rejectedBy: currentuser.sub, reason });

    return {
      success: true,
      data: updated,
      message: 'Property verification rejected.',
    };
  }

  async grantGracePeriod(
    cuid: string,
    pid: string,
    currentuser: ICurrentUser,
    expiresAt: string | Date,
    notes?: string
  ): Promise<ISuccessReturnData> {
    this.assertCanVerify(currentuser);

    const property = await this.findPropertyOrThrow(cuid, pid);

    if (property.verificationStatus === VerificationStatusEnum.VERIFIED) {
      throw new InvalidRequestError({
        message: 'Property is already verified. Grace period not needed.',
      });
    }

    const expiryDate = new Date(expiresAt);
    if (isNaN(expiryDate.getTime()) || expiryDate <= new Date()) {
      throw new BadRequestError({ message: 'Grace period expiry must be a future date.' });
    }

    const graceEntry = {
      action: 'grace_granted' as const,
      actor: new Types.ObjectId(currentuser.sub),
      timestamp: new Date(),
      ...(notes && { notes }),
    };

    const updated = await this.propertyDAO.update(
      { pid, cuid, deletedAt: null },
      {
        $set: {
          verificationGracePeriod: {
            expiresAt: expiryDate,
            grantedBy: new Types.ObjectId(currentuser.sub),
            ...(notes && { notes }),
          },
          lastModifiedBy: new Types.ObjectId(currentuser.sub),
        },
        $push: { verificationDetails: graceEntry },
      }
    );

    if (!updated) {
      throw new BadRequestError({
        message: t('common.errors.operationFailed', { action: 'grant grace period' }),
      });
    }

    await this.propertyCache.invalidateProperty(cuid, property.id);
    await this.propertyCache.invalidateLeaseableProperties(cuid);

    this.log.info('Verification grace period granted', {
      pid,
      grantedBy: currentuser.sub,
      expiresAt: expiryDate,
    });

    return {
      success: true,
      data: updated,
      message: `Grace period granted until ${expiryDate.toLocaleDateString()}. Property can be leased until then.`,
    };
  }
}
