import Logger from 'bunyan';
import { Types } from 'mongoose';
import { createLogger } from '@utils/index';
import { PropertyCache } from '@caching/index';
import { S3Service } from '@services/fileUpload';
import { GeoCoderService } from '@services/external';
import { ICurrentUser } from '@interfaces/user.interface';
import { IProperty } from '@interfaces/property.interface';
import { PropertyDAO, ProfileDAO, ClientDAO } from '@dao/index';
import { InvalidRequestError, BadRequestError } from '@shared/customErrors';
import { ExtractedMediaFile, ISuccessReturnData } from '@interfaces/utils.interface';

interface IConstructor {
  geoCoderService: GeoCoderService;
  propertyCache: PropertyCache;
  propertyDAO: PropertyDAO;
  profileDAO: ProfileDAO;
  s3Service: S3Service;
  clientDAO: ClientDAO;
}

export class PropertyService {
  private readonly log: Logger;
  private readonly s3Service: S3Service;
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
    s3Service,
  }: IConstructor) {
    this.s3Service = s3Service;
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.propertyDAO = propertyDAO;
    this.propertyCache = propertyCache;
    this.geoCoderService = geoCoderService;
    this.log = createLogger('PropertyService');
  }

  async createProperty(
    cid: string,
    propertyData: { scannedFiles?: ExtractedMediaFile[] } & IProperty,
    currentUser: ICurrentUser
  ): Promise<ISuccessReturnData> {
    const session = await this.propertyDAO.startSession();
    const result = await this.propertyDAO.withTransaction(session, async (session) => {
      const client = await this.clientDAO.getClientByCid(cid);
      if (!client) {
        this.log.error(`Client with cid ${cid} not found`);
        throw new BadRequestError({ message: 'Unable to add property to this account.' });
      }

      const { address } = propertyData;
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

      if (propertyData.scannedFiles && propertyData.documents) {
        propertyData.documents = propertyData.documents.map((doc, index) => {
          return {
            documentType: doc.documentType,
            uploadedBy: new Types.ObjectId(currentUser.sub),
            description: doc.description,
            uploadedAt: new Date(),
            photos: doc.photos,
          };
        });
      }

      const property = await this.propertyDAO.createProperty(
        {
          ...propertyData,
          cid,
        },
        session
      );

      // const property = await this.propertyDAO.createInstance({
      //   ...propertyData,
      //   cid,
      // });

      if (!property) {
        throw new BadRequestError({ message: 'Unable to create property.' });
      }

      return { property };
    });
    // add document to s3 via queues
    await this.propertyCache.cacheProperty(cid, result.property.id, result.property);
    return { success: true, data: result.property, message: 'Property created successfully' };
  }
}
