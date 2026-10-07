import { t } from '@shared/languages';
import { ICurrentUser } from '@interfaces/user.interface';
import { IInvitationData } from '@interfaces/invitation.interface';
import { IUserRole, ROLES } from '@shared/constants/roles.constants';
import { InvitationDAO, ClientDAO, VendorDAO, UserDAO } from '@dao/index';
import { InvitationValidations } from '@shared/validations/InvitationValidation';
import {
  ICsvHeaderValidationResult,
  ICsvValidationResult,
  IInvalidCsvProperty,
} from '@interfaces/csv.interface';

import { BaseCSVProcessorService } from './base';
import {
  INVITATION_REQUIRED_FIELD_KEYS,
  INVITATION_IMPORTABLE_FIELDS,
} from './invitationImportFields';

// Validated CSV row, plus vendor grouping metadata and the source row number
// (used to point per-row send failures back at the file).
export interface IInvitationCsvData extends IInvitationData {
  metadata?: {
    isPrimaryVendor?: boolean;
    isVendorTeamMember?: boolean;
    csvGroupId?: string;
    vendorEntityData?: {
      companyName: string;
      businessType: string;
      taxId?: string;
      registrationNumber?: string;
      yearsInBusiness?: number;
      contactPerson: {
        name: string;
        jobTitle: string;
        email: string;
        phone?: string;
      };
    };
  } & IInvitationData['metadata'];
  csvRowNumber?: number;
}

interface InvitationProcessingContext {
  // User-confirmed "file header → field key" map from the frontend mapping step
  columnMapping?: Record<string, string>;
  userId: ICurrentUser['sub'];
  cuid: string;
}

interface InvitationRunState extends InvitationProcessingContext {
  // Lowercased email → first row it appeared on, to flag duplicates within the file
  seenEmails: Map<string, number>;
  clientId: string;
}

interface IConstructor {
  invitationDAO: InvitationDAO;
  clientDAO: ClientDAO;
  vendorDAO: VendorDAO;
  userDAO: UserDAO;
}

const UNVERIFIED_PENDING_TENANT_LIMIT = 5;

const ACCEPTED_HEADERS = INVITATION_IMPORTABLE_FIELDS.map((field) => field.key);

const TEMPLATE_HEADERS = [
  'inviteeEmail',
  'firstName',
  'lastName',
  'role',
  'phoneNumber',
  'status',
  'inviteMessage',
  'employeeInfo_department',
  'employeeInfo_jobTitle',
  'vendorInfo_companyName',
  'vendorInfo_businessType',
  'tenantInfo_employerCompanyName',
  'tenantInfo_emergencyContactName',
  'tenantInfo_emergencyContactPhone',
];

const TEMPLATE_EXAMPLE_ROWS: Record<string, string>[] = [
  {
    inviteeEmail: 'jane.doe@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    role: 'staff',
    status: 'pending',
    employeeInfo_department: 'maintenance',
    employeeInfo_jobTitle: 'Maintenance Technician',
  },
  {
    inviteeEmail: 'amelie.cote@example.com',
    firstName: 'Amélie',
    lastName: 'Côté',
    role: 'tenant',
    phoneNumber: '+15145550123',
    status: 'pending',
    inviteMessage: 'Welcome to the building!',
    tenantInfo_employerCompanyName: 'Acme Inc.',
    tenantInfo_emergencyContactName: 'Marc Côté',
    tenantInfo_emergencyContactPhone: '+15145550199',
  },
  {
    inviteeEmail: 'owner@brightplumbing.example',
    firstName: 'Sam',
    lastName: 'Rivera',
    role: 'vendor',
    status: 'draft',
    vendorInfo_companyName: 'Bright Plumbing',
    vendorInfo_businessType: 'plumbing',
  },
];

const csvEscape = (value: string) =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export class InvitationCsvProcessor {
  private readonly invitationDAO: InvitationDAO;
  private readonly clientDAO: ClientDAO;
  private readonly userDAO: UserDAO;
  private readonly vendorDAO: VendorDAO;

  constructor({ invitationDAO, clientDAO, userDAO, vendorDAO }: IConstructor) {
    this.invitationDAO = invitationDAO;
    this.clientDAO = clientDAO;
    this.userDAO = userDAO;
    this.vendorDAO = vendorDAO;
  }

  async validateCsv(
    filePath: string,
    context: InvitationProcessingContext
  ): Promise<{
    validInvitations: IInvitationCsvData[];
    totalRows: number;
    finishedAt: Date;
    errors: null | IInvalidCsvProperty[];
  }> {
    const client = await this.clientDAO.getClientByCuid(context.cuid);
    if (!client) {
      throw new Error(t('invitation.errors.clientNotFound'));
    }

    const runState: InvitationRunState = {
      ...context,
      clientId: client.id,
      seenEmails: new Map(),
    };

    const result = await BaseCSVProcessorService.processCsvFile<
      IInvitationCsvData,
      InvitationRunState
    >(filePath, {
      context: runState,
      headerTransformer: this.createInvitationHeaderTransformer(context.columnMapping),
      validateHeaders: this.validateRequiredHeaders.bind(this),
      validateRow: this.validateInvitationRow,
      transformRow: this.transformInvitationRow,
      postProcess: this.postProcessInvitations,
    });

    return {
      validInvitations: result.validItems,
      totalRows: result.totalRows,
      finishedAt: new Date(),
      errors: result.errors,
    };
  }

  generateTemplateCsv(): string {
    const lines = [
      TEMPLATE_HEADERS.join(','),
      ...TEMPLATE_EXAMPLE_ROWS.map((row) =>
        TEMPLATE_HEADERS.map((header) => csvEscape(row[header] ?? '')).join(',')
      ),
    ];
    return lines.join('\n') + '\n';
  }

  getTemplateHeaders(): string[] {
    return [...TEMPLATE_HEADERS];
  }

  getAcceptedHeaders(): string[] {
    return [...ACCEPTED_HEADERS];
  }

  private validateInvitationRow = async (
    row: Record<string, unknown>,
    context: InvitationRunState,
    rowNumber: number
  ): Promise<ICsvValidationResult> => {
    const validationResult = await InvitationValidations.invitationCsv.safeParseAsync({
      ...this.withoutBlankCells(row),
      cuid: context.cuid,
    });

    if (!validationResult.success) {
      return {
        isValid: false,
        errors: validationResult.error.errors.map((err) => ({
          field: err.path.join('.') || 'unknown',
          error: err.message,
        })),
      };
    }

    const transformedData = validationResult.data;
    const emailKey = transformedData.inviteeEmail.toLowerCase();
    const firstSeenOnRow = context.seenEmails.get(emailKey);
    if (firstSeenOnRow !== undefined) {
      return this.rowError(
        'inviteeEmail',
        t('invitation.csv.duplicateEmailInFile', { row: firstSeenOnRow })
      );
    }
    context.seenEmails.set(emailKey, rowNumber);

    const existingUser = await this.userDAO.getUserWithClientAccess(
      transformedData.inviteeEmail,
      context.cuid
    );
    if (existingUser) {
      return this.rowError('inviteeEmail', t('invitation.errors.userAlreadyHasAccess'));
    }

    const existingInvitation = await this.invitationDAO.findPendingInvitation(
      transformedData.inviteeEmail,
      context.clientId
    );
    if (existingInvitation) {
      return this.rowError('inviteeEmail', t('invitation.errors.pendingInvitationExists'));
    }

    if (transformedData.role === ROLES.VENDOR && transformedData.linkedVendorUid) {
      // linkedVendorUid is the vendor organisation's vuid (team member joining it)
      const vuid = transformedData.linkedVendorUid;
      const existingVendor = await this.vendorDAO.getVendorByVuid(vuid);
      if (!existingVendor) {
        return this.rowError('linkedVendorUid', t('invitation.csv.vendorNotFound', { vuid }));
      }

      const vendorConnection = existingVendor.connectedClients?.find(
        (cc: any) => cc.cuid === context.cuid
      );
      if (!vendorConnection || !vendorConnection.isConnected) {
        return this.rowError('linkedVendorUid', t('invitation.csv.vendorNotConnected', { vuid }));
      }
    }

    if (
      transformedData.role === ROLES.VENDOR &&
      !transformedData.linkedVendorUid &&
      !transformedData.metadata?.vendorEntityData?.companyName
    ) {
      return this.rowError('vendorInfo_companyName', t('invitation.csv.vendorCompanyRequired'));
    }

    return { isValid: true, errors: [], transformedData };
  };

  private transformInvitationRow = async (
    _row: unknown,
    _context: InvitationRunState,
    rowNumber: number,
    validatedData?: IInvitationCsvData
  ): Promise<IInvitationCsvData> => {
    if (!validatedData) {
      throw new Error('No validated data provided to transformInvitationRow');
    }
    return { ...validatedData, csvRowNumber: rowNumber };
  };

  // Missing columns arrive as null and empty cells as "" — treat both as "not provided"
  // so optional fields stay optional and required ones report "Required".
  private withoutBlankCells(row: Record<string, unknown>): Record<string, string> {
    const cleaned: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value === null || value === undefined) continue;
      const text = String(value).trim();
      if (text !== '') cleaned[key] = text;
    }
    return cleaned;
  }

  private rowError(field: string, error: string): ICsvValidationResult {
    return { isValid: false, errors: [{ field, error }] };
  }

  private createInvitationHeaderTransformer(columnMapping?: Record<string, string>) {
    return ({ header }: { header: string }) => {
      const mappedKey = columnMapping?.[header];
      if (mappedKey && ACCEPTED_HEADERS.includes(mappedKey)) {
        return mappedKey;
      }

      const normalizedHeader = header.toLowerCase().trim();
      const matchingHeader = ACCEPTED_HEADERS.find(
        (accepted) => accepted.toLowerCase() === normalizedHeader
      );
      return matchingHeader ?? null; // csv-parser drops unmapped columns
    };
  }

  private validateRequiredHeaders(headers: string[]): ICsvHeaderValidationResult {
    const missingHeaders = INVITATION_REQUIRED_FIELD_KEYS.filter(
      (required) => !headers.includes(required)
    );
    const isValid = missingHeaders.length === 0;

    return {
      isValid,
      missingHeaders,
      foundHeaders: headers.filter((header) => ACCEPTED_HEADERS.includes(header)),
      errorMessage: isValid
        ? undefined
        : t('invitation.csv.missingColumns', { columns: missingHeaders.join(', ') }),
    };
  }

  private postProcessInvitations = async (
    invitations: IInvitationCsvData[],
    context: InvitationRunState
  ): Promise<{ validItems: IInvitationCsvData[]; invalidItems: IInvalidCsvProperty[] }> => {
    const invalidItems: IInvalidCsvProperty[] = [];
    const rejected = new Set<IInvitationCsvData>();
    const reject = (invitation: IInvitationCsvData, field: string, error: string) => {
      rejected.add(invitation);
      invalidItems.push({ rowNumber: invitation.csvRowNumber ?? 0, errors: [{ field, error }] });
    };

    // A registration number may only appear once among new vendors in the file
    const vendorsByRegistration = new Map<string, IInvitationCsvData[]>();
    for (const invitation of invitations) {
      const regNum = invitation.metadata?.isPrimaryVendor
        ? invitation.metadata?.vendorEntityData?.registrationNumber?.trim().toLowerCase()
        : undefined;
      if (!regNum) continue;
      vendorsByRegistration.set(regNum, [...(vendorsByRegistration.get(regNum) ?? []), invitation]);
    }
    for (const vendors of vendorsByRegistration.values()) {
      if (vendors.length < 2) continue;
      vendors.forEach((vendor) =>
        reject(
          vendor,
          'vendorInfo_registrationNumber',
          t('invitation.csv.duplicateRegistrationNumber', {
            value: vendor.metadata?.vendorEntityData?.registrationNumber ?? '',
          })
        )
      );
    }

    // Unverified accounts may hold at most 5 pending tenant invitations
    const client = await this.clientDAO.getClientByCuid(context.cuid);
    if (client && !client.isVerified) {
      const tenantRows = invitations.filter(
        (inv) => inv.role === ROLES.TENANT && !rejected.has(inv)
      );
      if (tenantRows.length > 0) {
        const pendingCount = await this.invitationDAO.countDocuments({
          client: client._id,
          role: IUserRole.TENANT,
          status: 'pending',
        });
        const allowed = Math.max(0, UNVERIFIED_PENDING_TENANT_LIMIT - pendingCount);
        tenantRows
          .slice(allowed)
          .forEach((inv) => reject(inv, 'role', t('invitation.errors.unverifiedTenantLimit')));
      }
    }

    const validItems = invitations.filter((inv) => !rejected.has(inv));

    // New vendors must exist before team members that join them
    const order = (inv: IInvitationCsvData) =>
      inv.metadata?.isPrimaryVendor ? 0 : inv.metadata?.isVendorTeamMember ? 2 : 1;
    validItems.sort((a, b) => order(a) - order(b));

    return { validItems, invalidItems };
  };
}
