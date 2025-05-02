import Logger from 'bunyan';
import { FilterQuery, Types } from 'mongoose';
import { EventTypes } from '@interfaces/index';
import { PropertyCache } from '@caching/index';
import { GeoCoderService } from '@services/external';
import { PropertyCsvProcessor } from '@services/csv';
import { createLogger, JOB_NAME } from '@utils/index';
import { ICurrentUser } from '@interfaces/user.interface';
import { PropertyQueue, UploadQueue } from '@queues/index';
import { EventEmitterService } from '@services/eventEmitter';
import { PropertyDAO, ProfileDAO, ClientDAO } from '@dao/index';
import { InvalidRequestError, BadRequestError, NotFoundError } from '@shared/customErrors';
import {
  IPropertyFilterQuery,
  IPropertyDocument,
  NewPropertyType,
} from '@interfaces/property.interface';
import {
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
    propertyData: { scannedFiles?: ExtractedMediaFile[] } & NewPropertyType,
    currentUser: ICurrentUser
  ): Promise<ISuccessReturnData> {
    const session = await this.propertyDAO.startSession();
    const result = await this.propertyDAO.withTransaction(session, async (session) => {
      const client = await this.clientDAO.getClientByCid(cid);
      if (!client) {
        this.log.error(`Client with cid ${cid} not found`);
        throw new BadRequestError({ message: 'Unable to add property to this account.' });
      }

      const { fullAddress } = propertyData;
      if (!fullAddress) {
        throw new BadRequestError({ message: 'Property address is required.' });
      }

      if (fullAddress && cid) {
        const existingProperty = await this.propertyDAO.findPropertyByAddress(
          fullAddress.toString(),
          cid.toString()
        );

        if (existingProperty) {
          throw new InvalidRequestError({
            message: 'A property with this address already exists for this client',
          });
        }
      }

      const gCode = await this.geoCoderService.parseLocation(fullAddress);
      if (!gCode) {
        throw new InvalidRequestError({ message: 'Invalid location provided.' });
      }
      propertyData.computedLocation = {
        coordinates: gCode.coordinates,
      };
      propertyData.address = {
        city: gCode.city,
        state: gCode.state,
        street: gCode.street,
        country: gCode.country,
        postCode: gCode.postCode,
        latAndlon: gCode.latAndlon,
        streetNumber: gCode.streetNumber,
        formattedAddress: gCode.formattedAddress,
      };
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

    const job = await this.propertyQueue.addCsvImportJob(jobData);
    return {
      success: true,
      data: { processId: job.id },
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
      throw new BadRequestError({ message: 'File size too large for processing.' });
    }

    const jobData = {
      cid,
      userId: currentUser.sub,
      csvFilePath: csvFile.path,
    };
    const job = await this.propertyQueue.addCsvValidationJob(jobData);
    return {
      success: true,
      data: { processId: job.id },
      message: 'CSV validation process started.',
    };
  }

  async getClientProperties(
    cid: string,
    queryParams: IPropertyFilterQuery
  ): Promise<ISuccessReturnData> {
    if (!cid) {
      throw new BadRequestError({ message: 'Client ID is required.' });
    }

    const client = await this.clientDAO.getClientByCid(cid);
    if (!client) {
      this.log.error(`Client with cid ${cid} not found`);
      throw new BadRequestError({ message: 'Unable to get properties for this account.' });
    }

    const { pagination, filters } = queryParams;
    const filter: FilterQuery<IPropertyDocument> = {
      cid,
      deletedAt: null,
    };

    if (filters) {
      if (filters.propertyType) {
        filter.propertyType = { $in: filters.propertyType };
      }

      if (filters.status) {
        filter.status = { $in: filters.status };
      }

      if (filters.occupancyStatus) {
        filter.occupancyStatus = filters.occupancyStatus;
      }

      if (filters.priceRange) {
        const priceFilter: any = {};
        if (typeof filters.priceRange.min === 'number') {
          priceFilter.$gte = filters.priceRange.min;
        }
        if (typeof filters.priceRange.max === 'number') {
          priceFilter.$lte = filters.priceRange.max;
        }
        if (Object.keys(priceFilter).length > 0) {
          filter['financialDetails.marketValue'] = priceFilter;
        }
      }

      if (filters.areaRange) {
        const areaFilter: any = {};
        if (typeof filters.areaRange.min === 'number') {
          areaFilter.$gte = filters.areaRange.min;
        }
        if (typeof filters.areaRange.max === 'number') {
          areaFilter.$lte = filters.areaRange.max;
        }
        if (Object.keys(areaFilter).length > 0) {
          filter['specifications.totalArea'] = areaFilter;
        }
      }

      if (filters.location) {
        if (filters.location.city) {
          filter['address.city'] = { $regex: new RegExp(filters.location.city, 'i') };
        }
        if (filters.location.state) {
          filter['address.state'] = { $regex: new RegExp(filters.location.state, 'i') };
        }
        if (filters.location.postCode) {
          filter['address.postCode'] = filters.location.postCode;
        }
      }

      if (filters.dateRange && filters.dateRange.field) {
        const dateFilter: any = {};
        if (filters.dateRange.start) {
          const startDate =
            typeof filters.dateRange.start === 'string'
              ? new Date(filters.dateRange.start)
              : filters.dateRange.start;
          dateFilter.$gte = startDate;
        }
        if (filters.dateRange.end) {
          const endDate =
            typeof filters.dateRange.end === 'string'
              ? new Date(filters.dateRange.end)
              : filters.dateRange.end;
          dateFilter.$lte = endDate;
        }
        if (Object.keys(dateFilter).length > 0) {
          filter[filters.dateRange.field] = dateFilter;
        }
      }

      if (filters.searchTerm && filters.searchTerm.trim()) {
        const searchRegex = new RegExp(filters.searchTerm.trim(), 'i');
        filter.$or = [
          { name: searchRegex },
          { 'address.city': searchRegex },
          { 'address.state': searchRegex },
          { 'address.postCode': searchRegex },
          { 'address.formattedAddress': searchRegex },
        ];
      }
    }

    const opts: IPaginationQuery = {
      page: pagination.page,
      sort: pagination.sort,
      sortBy: pagination.sortBy,
      limit: Math.max(1, Math.min(pagination.limit || 10, 100)),
      skip: ((pagination.page || 1) - 1) * (pagination.limit || 10),
    };
    const cachedResult = await this.propertyCache.getClientProperties(cid, opts);
    if (cachedResult.success && cachedResult.data) {
      return {
        success: true,
        ...cachedResult.data,
      };
    }
    const properties = await this.propertyDAO.getPropertiesByClientId(cid, filter, opts);
    await this.propertyCache.saveClientProperties(cid, properties.data, {
      filter,
      pagination: opts,
    });

    return {
      success: true,
      ...properties,
    };
  }

  async getClientProperty(
    cid: string,
    pid: string,
    _currentUser: ICurrentUser
  ): Promise<ISuccessReturnData> {
    if (!cid || !pid) {
      throw new BadRequestError({ message: 'Client ID and Property ID are required.' });
    }

    const client = await this.clientDAO.getClientByCid(cid);
    if (!client) {
      this.log.error(`Client with cid ${cid} not found`);
      throw new BadRequestError({ message: 'Unable to get properties for this account.' });
    }

    const property = await this.propertyDAO.findFirst({
      pid,
      cid,
      deletedAt: null,
    });
    if (!property) {
      throw new NotFoundError({ message: 'Unable to find property.' });
    }

    return { success: true, data: property };
  }

  async getFormattedAddress(
    data: { address: string },
    _currentUser: ICurrentUser
  ): Promise<ISuccessReturnData> {
    if (!data.address) {
      throw new BadRequestError({ message: 'Address is required.' });
    }

    const gCode = await this.geoCoderService.parseLocation(data.address);
    if (!gCode) {
      throw new BadRequestError({ message: 'Invalid location provided.' });
    }

    return { success: true, data: gCode };
  }
}
