import Logger from 'bunyan';
import { Types } from 'mongoose';
import { EventTypes } from '@interfaces/index';
import { PropertyCache } from '@caching/index';
import { GeoCoderService } from '@services/external';
import { PropertyCsvProcessor } from '@services/csv';
import { createLogger, JOB_NAME } from '@utils/index';
import { ICurrentUser } from '@interfaces/user.interface';
import { PropertyQueue, UploadQueue } from '@queues/index';
import { IProperty } from '@interfaces/property.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { PropertyDAO, ProfileDAO, ClientDAO } from '@dao/index';
import { IInvalidCsvProperty } from '@interfaces/csv.interface';
import { InvalidRequestError, BadRequestError } from '@shared/customErrors';
import {
  CsvProcessReturnData,
  ExtractedMediaFile,
  ISuccessReturnData,
  IPaginationQuery,
  UploadResult,
} from '@interfaces/utils.interface';

interface IConstructor {
  propertyCsvProcessor: PropertyCsvProcessor;
  emitterService: EventEmitterService;
  geoCoderService: GeoCoderService;
  propertyCache: PropertyCache;
  propertyQueue: PropertyQueue;
  uploadQueue: UploadQueue;
  propertyDAO: PropertyDAO;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
}

export class PropertyService {
  private readonly log: Logger;
  private uploadQueue: UploadQueue;
  private readonly clientDAO: ClientDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly propertyQueue: PropertyQueue;
  private readonly propertyCache: PropertyCache;
  private readonly geoCoderService: GeoCoderService;
  private readonly emitterService: EventEmitterService;
  private readonly propertyCsvProcessor: PropertyCsvProcessor;

  constructor({
    clientDAO,
    profileDAO,
    propertyDAO,
    uploadQueue,
    propertyCache,
    emitterService,
    propertyQueue,
    geoCoderService,
    propertyCsvProcessor,
  }: IConstructor) {
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.propertyDAO = propertyDAO;
    this.uploadQueue = uploadQueue;
    this.propertyQueue = propertyQueue;
    this.propertyCache = propertyCache;
    this.emitterService = emitterService;
    this.geoCoderService = geoCoderService;
    this.log = createLogger('PropertyService');
    this.propertyCsvProcessor = propertyCsvProcessor;
  }

  async addProperty(
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

      // if (propertyData.scannedFiles && propertyData.documents) {
      //   propertyData.documents = propertyData.documents.map((doc, index) => {
      //     return {
      //       documentType: doc.documentType,
      //       uploadedBy: new Types.ObjectId(currentUser.sub),
      //       description: doc.description,
      //       uploadedAt: new Date(),
      //       status: 'active',
      //       documentName:
      //     };
      //   });
      // }

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
    if (propertyData.scannedFiles && propertyData.scannedFiles.length > 0) {
      this.uploadQueue.addToUploadQueue(JOB_NAME.MEDIA_UPLOAD_JOB, {
        resource: {
          fieldName: 'documents',
          resourceType: 'unknown',
          resourceName: 'property',
          actorId: currentUser.sub,
          resourceId: result.property.id,
        },
        files: propertyData.scannedFiles,
      });
    }
    await this.propertyCache.cacheProperty(cid, result.property.id, result.property);
    return { success: true, data: result.property, message: 'Property created successfully' };
  }

  async addPropertiesFromCsv(
    cid: string,
    csvFilePath: string,
    actorId: string
  ): Promise<ISuccessReturnData> {
    if (!csvFilePath || !cid) {
      throw new BadRequestError({ message: 'No CSV file path provided' });
    }
    const client = await this.clientDAO.getClientByCid(cid);
    if (!client) {
      this.log.error(`Client with cid ${cid} not found`);
      throw new BadRequestError({ message: 'Unable to add property to this account.' });
    }

    const jobData = {
      csvFilePath,
      cid,
      userId: actorId,
    };

    await this.propertyQueue.addCsvImportJob(jobData);
    return {
      success: true,
      data: null,
      message: 'CSV import job started',
    };
  }

  async updatePropertyDocuments(
    propertyId: string,
    uploadResult: UploadResult[],
    userid: string
  ): Promise<ISuccessReturnData> {
    if (!propertyId) {
      throw new BadRequestError({ message: 'Property ID is required.' });
    }

    if (!uploadResult || uploadResult.length === 0) {
      throw new BadRequestError({ message: 'Upload result is required.' });
    }
    const property = await this.propertyDAO.findById(propertyId);
    if (!property) {
      throw new BadRequestError({ message: 'Unable to find client property.' });
    }

    const updatedProperty = await this.propertyDAO.updatePropertyDocument(
      propertyId,
      uploadResult,
      userid
    );

    if (!updatedProperty) {
      throw new BadRequestError({ message: 'Unable to update property.' });
    }

    return { success: true, data: updatedProperty, message: 'Property updated successfully' };
  }

  async createProperties(
    data: CsvProcessReturnData,
    csvFilePath: string
  ): Promise<{
    success: boolean;
    data: IProperty[];
    message?: string;
    error?: string;
    errors?: IInvalidCsvProperty[];
  }> {
    try {
      let properties = [];
      const session = await this.propertyDAO.startSession();
      const propertiesResult = await this.propertyDAO.withTransaction(session, async (session) => {
        const batchSize = 20;
        let batchCounter = 0;
        const batches = [];
        properties = [];

        for (let i = 0; i < data.data.length; i += batchSize) {
          const batch = data.data.slice(i, i + batchSize);
          batches.push(batch);
        }

        for (const batch of batches) {
          const batchProperties = await this.propertyDAO.insertMany(batch, session);
          properties.push(...batchProperties);
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          batchCounter++;
        }

        return { properties };
      });

      const returnResult = {
        data: propertiesResult.properties,
        errors: null,
        message: 'Properties added successfully.',
      } as CsvProcessReturnData & { message: string };

      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);

      return {
        success: true,
        data: returnResult.data,
        message: returnResult.message,
        ...(returnResult.errors ? { errors: returnResult.errors } : null),
      };
    } catch (error) {
      this.log.error(error, 'Error creating properties from CSV: ');
      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);
      return { success: false, data: [], error: 'Unable to create properties from CSV.' };
      // throw new BadRequestError({ message: 'Unable to create properties from CSV.' });
    }
  }

  async validateCsv(
    cid: string,
    csvFile: ExtractedMediaFile,
    currentUser: ICurrentUser
  ): Promise<ISuccessReturnData> {
    if (!csvFile) {
      throw new BadRequestError({ message: 'No CSV file uploaded' });
    }

    const client = await this.clientDAO.getClientByCid(cid);
    if (!client) {
      this.log.error(`Client with cid ${cid} not found`);
      throw new BadRequestError({ message: 'Unable to validate csv for this account.' });
    }

    if (csvFile.fileSize > 10 * 1024 * 1024) {
      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFile.path]);
      throw new BadRequestError({ message: 'File size to large for processing.' });
    }

    const jobData = {
      cid,
      userId: currentUser.sub,
      csvFilePath: csvFile.path,
    };
    this.propertyQueue.addCsvValidationJob(jobData);
    return {
      data: null,
      success: true,
      message: 'CSV validation process started.',
    };
  }

  async getClientProperties(cid: string, paginationData: IPaginationQuery) {
    if (!cid) {
      throw new BadRequestError({ message: 'Client ID is required.' });
    }

    const client = await this.clientDAO.getClientByCid(cid);
    if (!client) {
      this.log.error(`Client with cid ${cid} not found`);
      throw new BadRequestError({ message: 'Unable to get properties for this account.' });
    }

    const filter = {};
    const opts = {
      projection: '-computedLocation',
      skip: paginationData.skip ?? 0,
      limit: paginationData.limit ?? 10,
      sort: paginationData.sort,
    };
    const properties = await this.propertyDAO.getPropertiesByClientId(cid, filter, opts);
    return {
      success: true,
      ...properties,
    };
  }
}
