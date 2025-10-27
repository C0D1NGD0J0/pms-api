import Logger from 'bunyan';
import { t } from '@shared/languages';
import { PropertyDAO } from '@dao/propertyDAO';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { IPropertyDocument } from '@interfaces/property.interface';
import { EventEmitterService, AssetService } from '@services/index';
import { ProfileDAO, ClientDAO, LeaseDAO, UserDAO } from '@dao/index';
import { ValidationRequestError, InvalidRequestError, BadRequestError } from '@shared/customErrors';
import {
  ListResultWithPagination,
  IPromiseReturnedData,
  IRequestContext,
} from '@interfaces/utils.interface';
import {
  ILeaseFilterOptions,
  ILeaseDocument,
  ILeaseFormData,
  LeaseStatus,
} from '@interfaces/lease.interface';
import {
  PROPERTY_APPROVAL_ROLES,
  convertUserRoleToEnum,
  PROPERTY_STAFF_ROLES,
  createLogger,
  MoneyUtils,
} from '@utils/index';

interface IConstructor {
  emitterService: EventEmitterService;
  propertyUnitDAO: PropertyUnitDAO;
  assetService: AssetService;
  propertyDAO: PropertyDAO;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  leaseDAO: LeaseDAO;
  userDAO: UserDAO;
}

export class LeaseService {
  private readonly log: Logger;
  private readonly userDAO: UserDAO;
  private readonly leaseDAO: LeaseDAO;
  private readonly clientDAO: ClientDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly assetService: AssetService;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly emitterService: EventEmitterService;

  constructor({
    emitterService,
    propertyUnitDAO,
    clientDAO,
    assetService,
    propertyDAO,
    profileDAO,
    leaseDAO,
    userDAO,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.leaseDAO = leaseDAO;
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.propertyDAO = propertyDAO;
    this.assetService = assetService;
    this.emitterService = emitterService;
    this.propertyUnitDAO = propertyUnitDAO;
    this.log = createLogger('LeaseService');
  }

  async createLease(
    cuid: string,
    leaseData: ILeaseFormData,
    ctx: IRequestContext
  ): IPromiseReturnedData<ILeaseDocument> {
    const currentuser = ctx.currentuser!;
    this.log.info(`Creating lease for client ${cuid}`);

    if (!cuid) {
      throw new BadRequestError({ message: t('property.errors.clientIdRequired') });
    }

    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client) {
      this.log.error(`Client with cuid ${cuid} not found`);
      throw new BadRequestError({ message: t('common.errors.clientNotFound') });
    }

    const userRoleEnum = convertUserRoleToEnum(currentuser.client.role);
    if (
      !PROPERTY_STAFF_ROLES.includes(userRoleEnum) &&
      !PROPERTY_APPROVAL_ROLES.includes(userRoleEnum)
    ) {
      throw new InvalidRequestError({ message: 'You are not authorized to create leases.' });
    }

    const { hasErrors, errors } = await this.validateLeaseData(cuid, leaseData);
    if (hasErrors) {
      throw new ValidationRequestError({
        message: t('lease.errors.validationFailed') || 'Lease validation failed',
        errorInfo: errors,
      });
    }

    // TODO: Handle file uploads if leaseData contains files
    // Integration with AssetService for document uploads

    const parsedLeaseData = {
      ...leaseData,
      createdBy: currentuser.uid,
      fees: MoneyUtils.parseLeaseFees(leaseData.fees),
    };

    const lease = await this.leaseDAO.createLease(cuid, parsedLeaseData);

    this.log.info(`Lease created successfully: ${lease.luid}`);
    return { success: true, data: lease };
  }

  async getFilteredLeases(
    cuid: string,
    filters: ILeaseFilterOptions,
    _options: any
  ): ListResultWithPagination<ILeaseDocument> {
    this.log.info(`Getting filtered leases for client ${cuid}`, { filters });
    throw new Error('getFilteredLeases not yet implemented');
  }

  async getLeaseById(cuid: string, leaseId: string): IPromiseReturnedData<ILeaseDocument> {
    this.log.info(`Getting lease ${leaseId} for client ${cuid}`);
    throw new Error('getLeaseById not yet implemented');
  }

  async updateLease(
    cuid: string,
    leaseId: string,
    _updateData: Partial<ILeaseFormData>
  ): IPromiseReturnedData<ILeaseDocument> {
    this.log.info(`Updating lease ${leaseId} for client ${cuid}`);
    throw new Error('updateLease not yet implemented');
  }

  async deleteLease(cuid: string, leaseId: string, _userId: string): IPromiseReturnedData<boolean> {
    this.log.info(`Deleting lease ${leaseId} for client ${cuid}`);
    throw new Error('deleteLease not yet implemented');
  }

  async activateLease(
    cuid: string,
    leaseId: string,
    _activationData: any,
    _userId: string
  ): IPromiseReturnedData<ILeaseDocument> {
    this.log.info(`Activating lease ${leaseId} for client ${cuid}`);
    throw new Error('activateLease not yet implemented');
  }

  async terminateLease(
    cuid: string,
    leaseId: string,
    _terminationData: any,
    _userId: string
  ): IPromiseReturnedData<ILeaseDocument> {
    this.log.info(`Terminating lease ${leaseId} for client ${cuid}`);
    throw new Error('terminateLease not yet implemented');
  }

  async uploadLeaseDocument(
    cuid: string,
    leaseId: string,
    _file: any,
    _uploadedBy: string
  ): IPromiseReturnedData<ILeaseDocument> {
    this.log.info(`Uploading document for lease ${leaseId}`);
    throw new Error('uploadLeaseDocument not yet implemented');
  }

  async getLeaseDocumentUrl(cuid: string, leaseId: string): IPromiseReturnedData<string> {
    this.log.info(`Getting document URL for lease ${leaseId}`);
    throw new Error('getLeaseDocumentUrl not yet implemented');
  }

  async removeLeaseDocument(
    cuid: string,
    leaseId: string,
    _userId: string
  ): IPromiseReturnedData<ILeaseDocument> {
    this.log.info(`Removing document for lease ${leaseId}`);
    throw new Error('removeLeaseDocument not yet implemented');
  }

  async sendLeaseForSignature(
    _cuid: string,
    leaseId: string,
    _signers: any[],
    provider: string,
    _userId: string
  ): IPromiseReturnedData<ILeaseDocument> {
    this.log.info(`Sending lease ${leaseId} for signature via ${provider}`);
    throw new Error('sendLeaseForSignature not yet implemented');
  }

  async markAsManualySigned(
    _cuid: string,
    leaseId: string,
    _signedBy: any[],
    _userId: string
  ): IPromiseReturnedData<ILeaseDocument> {
    this.log.info(`Marking lease ${leaseId} as manually signed`);
    throw new Error('markAsManualySigned not yet implemented');
  }

  async cancelSignature(
    _cuid: string,
    leaseId: string,
    _userId: string
  ): IPromiseReturnedData<ILeaseDocument> {
    this.log.info(`Cancelling signature for lease ${leaseId}`);
    throw new Error('cancelSignature not yet implemented');
  }

  async getSignatureDetails(cuid: string, leaseId: string): IPromiseReturnedData<any> {
    this.log.info(`Getting signature details for lease ${leaseId}`);
    throw new Error('getSignatureDetails not yet implemented');
  }

  async handleSignatureWebhook(event: any): IPromiseReturnedData<boolean> {
    this.log.info('Handling signature webhook', { eventType: event.type });
    throw new Error('handleSignatureWebhook not yet implemented');
  }

  async generateLeasePDF(
    cuid: string,
    leaseId: string,
    _userId: string
  ): IPromiseReturnedData<any> {
    this.log.info(`Generating PDF for lease ${leaseId}`);
    throw new Error('generateLeasePDF not yet implemented');
  }

  async previewLeaseHTML(cuid: string, leaseId: string): IPromiseReturnedData<string> {
    this.log.info(`Previewing HTML for lease ${leaseId}`);
    throw new Error('previewLeaseHTML not yet implemented');
  }

  async downloadLeasePDF(cuid: string, leaseId: string): IPromiseReturnedData<any> {
    this.log.info(`Downloading PDF for lease ${leaseId}`);
    throw new Error('downloadLeasePDF not yet implemented');
  }

  async getExpiringLeases(
    cuid: string,
    daysThreshold: number = 30
  ): IPromiseReturnedData<ILeaseDocument[]> {
    this.log.info(`Getting leases expiring within ${daysThreshold} days for client ${cuid}`);
    throw new Error('getExpiringLeases not yet implemented');
  }

  async getLeaseStats(cuid: string, filters?: any): IPromiseReturnedData<any> {
    this.log.info(`Getting lease statistics for client ${cuid}`, { filters });
    throw new Error('getLeaseStats not yet implemented');
  }

  async exportLeases(cuid: string, format: string, filters?: any): IPromiseReturnedData<any> {
    this.log.info(`Exporting leases for client ${cuid} as ${format}`, { filters });
    throw new Error('exportLeases not yet implemented');
  }

  /**
   * Validates lease data and collects all validation errors
   * @param cuid - Client ID
   * @param leaseData - Lease form data to validate
   * @param validationErrors - Object to collect validation errors
   * @returns Object with hasErrors boolean and errors record
   */
  private async validateLeaseData(
    cuid: string,
    leaseData: ILeaseFormData
  ): Promise<{ hasErrors: boolean; errors: Record<string, string[]> }> {
    let property: IPropertyDocument | null = null;
    const validationErrors: Record<string, string[]> = {};

    // 1. Validate property exists and is active
    if (leaseData.property) {
      property = await this.propertyDAO.findFirst({
        id: leaseData.property.id,
        deletedAt: null,
        cuid,
      });

      if (!property) {
        if (!validationErrors['property.id']) validationErrors['property.id'] = [];
        validationErrors['property.id'].push(t('common.errors.propertyNotFound'));
      } else if (property.status !== 'available') {
        if (!validationErrors['property.id']) validationErrors['property.id'] = [];
        validationErrors['property.id'].push(t('lease.errors.propertyNotActive'));
      }

      // 2. Validate unit if provided
      if (leaseData.property.unitId && property) {
        const unit = await this.propertyUnitDAO.findFirst({
          unitId: leaseData.property.unitId,
          deletedAt: null,
          propertyId: property._id,
        });
        if (!unit || unit.propertyId.toString() !== property._id.toString()) {
          if (!validationErrors['property.unitId']) validationErrors['property.unitId'] = [];
          validationErrors['property.unitId'].push(t('lease.errors.unitNotFound'));
        } else if (unit.status !== 'available') {
          if (!validationErrors['property.unitId']) validationErrors['property.unitId'] = [];
          validationErrors['property.unitId'].push(t('lease.errors.unitNotAvailable'));
        }
      }
    }

    if (!leaseData.tenantId) {
      if (!validationErrors['tenantId']) validationErrors['tenantId'] = [];
      validationErrors['tenantId'].push(t('lease.errors.tenantIdRequired'));
    } else {
      const tenant = await this.profileDAO.findFirst({
        user: leaseData.tenantId,
        cuid,
        deletedAt: null,
      });
      if (!tenant) {
        if (!validationErrors['tenantId']) validationErrors['tenantId'] = [];
        validationErrors['tenantId'].push(t('lease.errors.tenantNotFound'));
      } else {
        const tenantCurrentUserProfile = await this.profileDAO.generateCurrentUserInfo(
          tenant.user.toString()
        );
        if (tenantCurrentUserProfile!.client.role !== 'tenant') {
          if (!validationErrors['tenantId']) validationErrors['tenantId'] = [];
          validationErrors['tenantId'].push(t('common.errors.invalidUserRole'));
        }
      }
    }

    // 4. Validate dates
    if (
      leaseData.duration.endDate &&
      new Date(leaseData.duration.endDate) <= new Date(leaseData.duration.startDate)
    ) {
      if (!validationErrors['duration.endDate']) validationErrors['duration.endDate'] = [];
      validationErrors['duration.endDate'].push(t('lease.errors.endDateMustBeAfterStartDate'));
    }
    if (
      leaseData.duration.moveInDate &&
      new Date(leaseData.duration.moveInDate) < new Date(leaseData.duration.startDate)
    ) {
      if (!validationErrors['duration.moveInDate']) validationErrors['duration.moveInDate'] = [];
      validationErrors['duration.moveInDate'].push(
        t('lease.errors.moveInDateMustBeOnOrAfterStartDate')
      );
    }

    // 5. Validate financial terms
    if (leaseData.fees.monthlyRent <= 0 || isNaN(leaseData.fees.monthlyRent)) {
      if (!validationErrors['fees.monthlyRent']) validationErrors['fees.monthlyRent'] = [];
      validationErrors['fees.monthlyRent'].push(t('lease.errors.rentMustBePositive'));
    }
    if (leaseData.fees.securityDeposit < 0 || isNaN(leaseData.fees.securityDeposit)) {
      if (!validationErrors['fees.securityDeposit']) validationErrors['fees.securityDeposit'] = [];
      validationErrors['fees.securityDeposit'].push(t('lease.errors.depositCannotBeNegative'));
    }
    if (leaseData.fees.rentDueDay < 1 || leaseData.fees.rentDueDay > 31) {
      if (!validationErrors['fees.rentDueDay']) validationErrors['fees.rentDueDay'] = [];
      validationErrors['fees.rentDueDay'].push(t('lease.errors.rentDueDayMustBeBetween1And31'));
    }
    if (leaseData.fees.lateFeeType === 'percentage' && !leaseData.fees.lateFeePercentage) {
      if (!validationErrors['fees.lateFeePercentage'])
        validationErrors['fees.lateFeePercentage'] = [];
      validationErrors['fees.lateFeePercentage'].push(
        'Late fee percentage is required when late fee type is percentage'
      );
    }

    // 6. Check for overlapping leases
    if (property) {
      const overlappingLeases = await this.leaseDAO.checkOverlappingLeases(
        cuid,
        leaseData.property.id,
        leaseData.property.unitId,
        new Date(leaseData.duration.startDate),
        leaseData.duration.endDate ? new Date(leaseData.duration.endDate) : new Date('2099-12-31')
      );
      if (overlappingLeases.length > 0) {
        if (!validationErrors['lease']) validationErrors['lease'] = [];
        validationErrors['lease'].push(t('lease.errors.overlappingLease'));
      }
    }

    // 7. Mongoose schema validation
    try {
      const leaseInstance = this.leaseDAO.createInstance({
        cuid,
        type: leaseData.type,
        tenantId: leaseData.tenantId,
        property: {
          id: leaseData.property.id,
          unitId: leaseData.property.unitId,
          address: leaseData.property.address,
        },
        duration: {
          startDate: new Date(leaseData.duration.startDate),
          endDate: new Date(leaseData.duration.endDate),
          moveInDate: leaseData.duration.moveInDate
            ? new Date(leaseData.duration.moveInDate)
            : undefined,
        },
        fees: MoneyUtils.parseLeaseFees(leaseData.fees),
        renewalOptions: leaseData.renewalOptions,
        petPolicy: leaseData.petPolicy,
        legalTerms: leaseData.legalTerms,
        coTenants: leaseData.coTenants,
        status: LeaseStatus.DRAFT,
      });

      const mongooseErrors = leaseInstance.validateSync();
      if (mongooseErrors) {
        Object.keys(mongooseErrors.errors).forEach((key) => {
          if (!validationErrors[key]) validationErrors[key] = [];
          validationErrors[key].push(mongooseErrors.errors[key].message);
        });
      }
    } catch (error: any) {
      if (!validationErrors['schema']) validationErrors['schema'] = [];
      validationErrors['schema'].push(error.message || 'Schema validation failed');
    }

    return { hasErrors: Object.keys(validationErrors).length > 0, errors: validationErrors };
  }
}
