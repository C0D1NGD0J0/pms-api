import Logger from 'bunyan';
import { PropertyDAO, ClientDAO, UserDAO } from '@dao/index';
import { getRequestDuration, createLogger } from '@utils/index';
import { BadRequestError, NotFoundError } from '@shared/customErrors/index';
import { ISuccessReturnData, IRequestContext } from '@interfaces/utils.interface';
import { PopulatedAccountAdmin, IClientDocument, IClientStats } from '@interfaces/client.interface';
import { t } from '@shared/languages';

interface IConstructor {
  propertyDAO: PropertyDAO;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

export class ClientService {
  private readonly log: Logger;
  private readonly clientDAO: ClientDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly userDAO: UserDAO;

  constructor({ clientDAO, propertyDAO, userDAO }: IConstructor) {
    this.log = createLogger('ClientService');
    this.clientDAO = clientDAO;
    this.propertyDAO = propertyDAO;
    this.userDAO = userDAO;
  }

  async updateClientDetails(
    cxt: IRequestContext,
    updateData: Partial<IClientDocument>
  ): Promise<ISuccessReturnData<IClientDocument>> {
    const currentuser = cxt.currentuser!;
    const start = process.hrtime.bigint();
    const { cid } = cxt.request.params;

    const client = await this.clientDAO.getClientByCid(cid);
    if (!client) {
      this.log.error(
        {
          cid,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          data: JSON.stringify(updateData),
          duration: getRequestDuration(start).durationInMs,
        },
        t('client.errors.notFound')
      );
      throw new NotFoundError({ message: t('client.errors.notFound') });
    }

    // Validation errors collection
    const validationErrors: string[] = [];
    let requiresReVerification = false;

    // Email format validation helper
    const isValidEmail = (email: string): boolean => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(email);
    };

    // 1. Identification validation
    if (updateData.identification) {
      // Check if ID type is changing
      if (
        updateData.identification.idType &&
        client.identification?.idType &&
        updateData.identification.idType !== client.identification.idType
      ) {
        requiresReVerification = true;
        this.log.info(
          {
            cid,
            oldIdType: client.identification.idType,
            newIdType: updateData.identification.idType,
            userId: currentuser.sub,
          },
          t('client.logging.idTypeChanged')
        );
      }

      if (updateData.identification.idType && !updateData.identification.idNumber) {
        validationErrors.push(t('client.validation.idNumberRequired'));
      }
      if (updateData.identification.idType && !updateData.identification.authority) {
        validationErrors.push(t('client.validation.authorityRequired'));
      }
      if (updateData.identification.idNumber && !updateData.identification.idType) {
        validationErrors.push(t('client.validation.idTypeRequired'));
      }
    }

    if (updateData.companyProfile) {
      if (
        updateData.companyProfile.companyEmail &&
        !isValidEmail(updateData.companyProfile.companyEmail)
      ) {
        validationErrors.push(t('client.validation.invalidEmailFormat'));
      }

      if (
        updateData.companyProfile.legalEntityName &&
        updateData.companyProfile.legalEntityName !== client.companyProfile?.legalEntityName
      ) {
        requiresReVerification = true;
      }
      if (
        updateData.companyProfile.registrationNumber &&
        updateData.companyProfile.registrationNumber !== client.companyProfile?.registrationNumber
      ) {
        requiresReVerification = true;
      }
    }

    if (updateData.displayName) {
      if (updateData.displayName.trim().length === 0) {
        validationErrors.push(t('client.validation.displayNameEmpty'));
      }
      if (updateData.displayName !== client.displayName) {
        requiresReVerification = true;
      }
    }

    if (requiresReVerification) {
      updateData.isVerified = false;
    }

    const changedFields = Object.keys(updateData);
    this.log.info(
      {
        cid,
        userId: currentuser.sub,
        requestId: cxt.requestId,
        changedFields: JSON.stringify(changedFields),
        requiresReVerification,
      },
      t('client.logging.validationCompleted')
    );

    if (validationErrors.length > 0) {
      this.log.error(
        {
          cid,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          validationErrors,
          duration: getRequestDuration(start).durationInMs,
        },
        t('client.logging.validationFailed')
      );
      throw new BadRequestError({
        message: t('client.errors.validationFailed'),
        errorInfo: { validationErrors },
      });
    }

    const session = await this.clientDAO.startSession();
    const result = await this.clientDAO.withTransaction(session, async (session) => {
      // prevent updating certain fields
      delete updateData.accountAdmin;
      delete updateData.accountType;
      delete updateData.isVerified;
      delete updateData.cid;

      const updatedClient = await this.clientDAO.updateById(
        client._id.toString(),
        {
          $set: {
            ...updateData,
            lastModifiedBy: currentuser.sub,
          },
        },
        undefined,
        session
      );
      if (!updatedClient) {
        this.log.error(
          {
            cid,
            url: cxt.request.url,
            userId: currentuser?.sub,
            requestId: cxt.requestId,
            data: JSON.stringify(updateData),
            duration: getRequestDuration(start).durationInMs,
          },
          t('client.logging.updateFailed')
        );
        throw new BadRequestError({ message: t('client.errors.updateFailed') });
      }

      return { updatedClient };
    });

    return {
      success: true,
      data: result.updatedClient,
      message: t('client.success.updated'),
    };
  }

  async getClientDetails(
    cxt: IRequestContext
  ): Promise<ISuccessReturnData<{ clientStats: IClientStats } & IClientDocument>> {
    const currentuser = cxt.currentuser!;
    const start = process.hrtime.bigint();
    const { cid } = cxt.request.params;
    if (!cid) {
      this.log.error(
        {
          cid,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        t('client.logging.missingParameters')
      );
      throw new BadRequestError({ message: t('client.errors.fetchFailed') });
    }

    const [client, usersResult, propertiesResult] = await Promise.all([
      this.clientDAO.getClientByCid(cid, {
        populate: {
          path: 'accountAdmin',
          select: 'email',
          populate: {
            path: 'profile',
            select:
              'personalInfo.firstName personalInfo.lastName personalInfo.phoneNumber personalInfo.avatar',
          },
        },
        limit: 1,
        skip: 0,
      }),
      this.userDAO.getUsersByClientId(cid, {}, { limit: 1000, skip: 0 }),
      this.propertyDAO.countDocuments({ cid, deletedAt: null }),
    ]);

    if (!client) {
      this.log.error(
        {
          cid,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        t('client.logging.detailsNotFound')
      );
      throw new NotFoundError({ message: t('client.errors.detailsNotFound') });
    }

    const clientWithStats = client.toObject() as { clientStats: IClientStats } & IClientDocument;
    clientWithStats.clientStats = {
      totalProperties: propertiesResult,
      totalUsers: usersResult.pagination?.total || 0,
    };

    clientWithStats.accountAdmin = {
      emai: (client.accountAdmin as any)?.email || '',
      id: (client.accountAdmin as any)?._id?.toString() || '',
      firstName: (client.accountAdmin as any)?.profile?.personalInfo?.firstName || '',
      lastName: (client.accountAdmin as any)?.profile?.personalInfo?.lastName || '',
      phoneNumber: (client.accountAdmin as any)?.profile?.personalInfo?.phoneNumber || '',
      avatar: (client.accountAdmin as any)?.profile?.personalInfo?.avatar || '',
    } as unknown as PopulatedAccountAdmin;

    return {
      data: clientWithStats,
      success: true,
      message: t('client.success.retrieved'),
    };
  }
}
