import dayjs from 'dayjs';
import Logger from 'bunyan';
import { envVariables } from '@shared/config';
import { AuthTokenService } from '@services/auth';
import { ProfileDAO, ClientDAO, PropertyDAO } from '@dao/index';
import { ISuccessReturnData } from '@interfaces/utils.interface';
import { hashGenerator, JWT_KEY_NAMES, createLogger, JOB_NAME } from '@utils/index';
import {
  InvalidRequestError,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '@shared/customErrors';
import { PropertyCache } from '@caching/index';
import { IProperty } from '@interfaces/property.interface';
import { ICurrentUser } from '@interfaces/user.interface';
import { GeoCoderService } from '@services/external';
import { Types } from 'mongoose';

interface IConstructor {
  geoCoderService: GeoCoderService;
  propertyCache: PropertyCache;
  propertyDAO: PropertyDAO;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
}

export class PropertyService {
  private readonly log: Logger;
  private readonly clientDAO: ClientDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly propertyCache: PropertyCache;
  private readonly geoCoderService: GeoCoderService;

  constructor({
    clientDAO,
    profileDAO,
    propertyDAO,
    propertyCache,
    geoCoderService,
  }: IConstructor) {
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.propertyDAO = propertyDAO;
    this.propertyCache = propertyCache;
    this.geoCoderService = geoCoderService;
    this.log = createLogger('PropertyService');
  }

  async createProperty(
    cid: string,
    propertyData: IProperty,
    currentUser: ICurrentUser
  ): Promise<ISuccessReturnData> {
    const session = await this.propertyDAO.startSession();
    const result = await this.propertyDAO.withTransaction(session, async (session) => {
      const client = await this.clientDAO.getClientByCid(cid);
      if (!client) {
        this.log.error(`Client with cid ${cid} not found`);
        throw new BadRequestError({ message: 'Unable to add property to this account.' });
      }

      let { address } = propertyData;
      if (!address) {
        throw new BadRequestError({ message: 'Property address is required.' });
      }

      if (address && cid) {
        const existingProperty = await this.propertyDAO.findPropertyByAddress(
          address.toString(),
          cid.toString()
        );

        if (existingProperty) {
          throw new InvalidRequestError({
            message: 'A property with this address already exists for this client',
          });
        }
      }

      // Get computed addres details
      const gCode = await this.geoCoderService.parseLocation(address);
      if (!gCode) {
        throw new BadRequestError({ message: 'Invalid location provided.' });
      }
      propertyData.computedLocation = {
        type: 'Point',
        coordinates: [gCode[0]?.longitude || 200, gCode[0]?.latitude || 201],
        address: {
          city: gCode[0].city,
          state: gCode[0].state,
          country: gCode[0].country,
          postCode: gCode[0].zipcode,
          street: gCode[0].streetName,
          streetNumber: gCode[0].streetNumber,
        },
        latAndlon: `${gCode[0].longitude || 200} ${gCode[0].latitude || 201}`,
      };
      propertyData.address = gCode[0]?.formattedAddress || '';
      propertyData.createdBy = new Types.ObjectId(currentUser.sub);
      propertyData.managedBy = propertyData.managedBy
        ? new Types.ObjectId(propertyData.managedBy)
        : new Types.ObjectId(currentUser.sub);

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

      return { property };
    });

    await this.propertyCache.cacheProperty(cid, result.property.id, result.property);
    return { success: true, data: result.property, message: 'Property created successfully' };
  }
}
