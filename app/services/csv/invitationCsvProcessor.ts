import { z } from 'zod';
import { ICurrentUser } from '@interfaces/user.interface';
import { ROLES } from '@shared/constants/roles.constants';
import { IInvitationData } from '@interfaces/invitation.interface';
import { InvitationDAO, ClientDAO, VendorDAO, UserDAO } from '@dao/index';
import { InvitationValidations } from '@shared/validations/InvitationValidation';
import {
  ICsvHeaderValidationResult,
  ICsvValidationResult,
  IInvalidCsvProperty,
} from '@interfaces/csv.interface';

import { BaseCSVProcessorService } from './base';

// Extended interface for CSV processing with vendor-specific metadata
interface IInvitationCsvData extends IInvitationData {
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
}

interface IConstructor {
  invitationDAO: InvitationDAO;
  clientDAO: ClientDAO;
  vendorDAO: VendorDAO;
  userDAO: UserDAO;
}

interface InvitationProcessingContext {
  userId: ICurrentUser['sub'];
  cuid: string;
}

type InvitationCsvInputType = z.input<typeof InvitationValidations.invitationCsv>;

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
      throw new Error(`Client with ID ${context.cuid} not found`);
    }

    const result = await BaseCSVProcessorService.processCsvFile<
      IInvitationCsvData,
      InvitationProcessingContext
    >(filePath, {
      context,
      headerTransformer: this.createInvitationHeaderTransformer(),
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

  private validateInvitationRow = async (
    row: any,
    context: InvitationProcessingContext,
    _rowNumber: number
  ): Promise<ICsvValidationResult> => {
    const rowWithContext = {
      ...row,
      cuid: context.cuid,
      role: row.role?.toString().toLowerCase(),
    };

    const validationResult =
      await InvitationValidations.invitationCsv.safeParseAsync(rowWithContext);

    if (validationResult.success) {
      const transformedData = validationResult.data;

      // check if user already exists and has access to this client
      const existingUser = await this.userDAO.getUserWithClientAccess(
        transformedData.inviteeEmail,
        context.cuid
      );

      if (existingUser) {
        return {
          isValid: false,
          errors: [
            {
              field: 'inviteeEmail',
              error: 'User already has access to this client',
            },
          ],
        };
      }

      const client = await this.clientDAO.getClientByCuid(context.cuid);
      if (!client) {
        return {
          isValid: false,
          errors: [{ field: 'cuid', error: `Client with ID ${context.cuid} not found` }],
        };
      }

      // Check if there's already a pending invitation for this email and client
      const existingInvitation = await this.invitationDAO.findPendingInvitation(
        transformedData.inviteeEmail,
        client.id
      );

      if (existingInvitation) {
        return {
          isValid: false,
          errors: [
            {
              field: 'inviteeEmail',
              error: 'A pending invitation already exists for this email',
            },
          ],
        };
      }

      // Validate vendor linkage for vendor role
      if (transformedData.role === ROLES.VENDOR && transformedData.linkedVendorUid) {
        // Check if the linkedVendorUid refers to an existing vendor
        const existingVendor = await this.vendorDAO.getVendorByVuid(
          transformedData.linkedVendorUid
        );

        if (!existingVendor) {
          return {
            isValid: false,
            errors: [
              {
                field: 'linkedVendorUid',
                error: `Vendor with ID ${transformedData.linkedVendorUid} not found in the system`,
              },
            ],
          };
        }

        // Check if vendor is connected to this client
        const vendorConnection = existingVendor.connectedClients?.find(
          (cc: any) => cc.cuid === context.cuid
        );

        if (!vendorConnection || !vendorConnection.isConnected) {
          return {
            isValid: false,
            errors: [
              {
                field: 'linkedVendorUid',
                error: `Vendor ${transformedData.linkedVendorUid} is not connected to this client`,
              },
            ],
          };
        }
      }

      // Validate that vendor role with no linkedVendorUid has required vendor fields
      if (transformedData.role === ROLES.VENDOR && !transformedData.linkedVendorUid) {
        if (!transformedData.metadata?.vendorEntityData?.companyName) {
          return {
            isValid: false,
            errors: [
              {
                field: 'vendorInfo_companyName',
                error: 'Company name is required for primary vendor creation',
              },
            ],
          };
        }
      }

      // Validation successful - pass the transformed data through
      return {
        isValid: true,
        errors: [],
        transformedData, // Pass the transformed data to the transform step
      };
    } else {
      const formattedErrors = validationResult.error.errors.map((err) => ({
        field: err.path.join('.'),
        error: err.message,
      }));

      return {
        isValid: false,
        errors: formattedErrors,
      };
    }
  };

  private transformInvitationRow = async (
    _row: any,
    _context: InvitationProcessingContext,
    _rowNumber: number,
    validatedData?: any
  ): Promise<IInvitationCsvData> => {
    // Simply return the validated/transformed data passed from the validation step
    if (!validatedData) {
      throw new Error(
        'No validated data provided to transformInvitationRow. This indicates a validation/transform flow issue.'
      );
    }

    return validatedData as IInvitationCsvData;
  };

  private getRequiredCsvHeaders(): string[] {
    return this.getKeysFromInvitationType();
  }

  private getKeysFromInvitationType(): string[] {
    // Extract keys from the CSV input schema (flattened fields before transformation)
    const allKeys = this.extractKeysFromCsvSchema();

    // Filter out internal fields that shouldn't be user-facing
    return allKeys.filter((key) => key !== 'cuid');
  }

  private extractKeysFromCsvSchema(): string[] {
    try {
      const schema = InvitationValidations.invitationCsv;

      // Get the inner schema (before transformation) if it's wrapped in ZodEffects
      const innerSchema = schema._def?.schema || schema;

      if (innerSchema.shape) {
        // Extract field names from the schema shape - these are the CSV column names
        return Object.keys(innerSchema.shape);
      }

      throw new Error('Cannot extract schema shape');
    } catch (error) {
      // Type-safe fallback using the input type
      const knownKeys: (keyof InvitationCsvInputType)[] = [
        'inviteeEmail',
        'role',
        'status',
        'firstName',
        'lastName',
        'phoneNumber',
        'inviteMessage',
        'expectedStartDate',
        'employeeInfo_department',
        'employeeInfo_jobTitle',
        'employeeInfo_employeeId',
        'employeeInfo_reportsTo',
        'employeeInfo_startDate',
        'vendorInfo_companyName',
        'vendorInfo_businessType',
        'vendorInfo_taxId',
        'vendorInfo_registrationNumber',
        'vendorInfo_yearsInBusiness',
        'vendorInfo_contactPerson_name',
        'vendorInfo_contactPerson_jobTitle',
        'vendorInfo_contactPerson_email',
        'vendorInfo_contactPerson_phone',
        'tenantInfo_employerCompanyName',
        'tenantInfo_employerPosition',
        'tenantInfo_employerMonthlyIncome',
        'tenantInfo_employerContactPerson',
        'tenantInfo_employerCompanyAddress',
        'tenantInfo_employerContactEmail',
        'tenantInfo_emergencyContactName',
        'tenantInfo_emergencyContactPhone',
        'tenantInfo_emergencyContactRelationship',
        'tenantInfo_emergencyContactEmail',
      ];
      return knownKeys as string[];
    }
  }

  private createInvitationHeaderTransformer() {
    const requiredHeaders = this.getRequiredCsvHeaders();

    return ({ header }: { header: string }) => {
      const normalizedHeader = header.toLowerCase().trim();
      const matchingRequired = requiredHeaders.find(
        (required) => required.toLowerCase() === normalizedHeader
      );

      if (matchingRequired) {
        return matchingRequired;
      }

      return null; // return null for headers that are not required
    };
  }

  private validateRequiredHeaders(headers: string[]): ICsvHeaderValidationResult {
    // Only these fields are truly required for invitation processing
    const actuallyRequiredHeaders = ['inviteeEmail', 'role', 'firstName', 'lastName', 'status'];
    const allValidHeaders = this.getRequiredCsvHeaders();

    const foundHeaders = headers.filter((header) => allValidHeaders.includes(header));
    const missingRequiredHeaders = actuallyRequiredHeaders.filter(
      (required) => !headers.includes(required)
    );

    const isValid = missingRequiredHeaders.length === 0;

    return {
      isValid,
      missingHeaders: missingRequiredHeaders,
      foundHeaders,
      errorMessage: isValid
        ? undefined
        : `Invalid CSV format. Missing required columns: ${missingRequiredHeaders.join(', ')}. Available optional columns: ${allValidHeaders.filter((h) => !actuallyRequiredHeaders.includes(h)).join(', ')}`,
    };
  }

  private postProcessInvitations = async (
    invitations: IInvitationCsvData[],
    _context: InvitationProcessingContext
  ): Promise<{ validItems: IInvitationCsvData[]; invalidItems: any[] }> => {
    const validItems: IInvitationCsvData[] = [];
    const invalidItems: any[] = [];

    // Separate vendors by type
    const primaryVendors = invitations.filter(
      (inv) => inv.role === ROLES.VENDOR && inv.metadata?.isPrimaryVendor
    );
    const vendorTeamMembers = invitations.filter(
      (inv) => inv.role === ROLES.VENDOR && inv.metadata?.isVendorTeamMember
    );
    const nonVendors = invitations.filter((inv) => inv.role !== ROLES.VENDOR);

    // Process vendor team members (already validated against database in validateInvitationRow)
    validItems.push(...vendorTeamMembers);

    // Validate unique registration numbers within the CSV
    const registrationNumbers = new Map<string, IInvitationCsvData>();
    const duplicateRegNums = new Set<string>();

    for (const vendor of primaryVendors) {
      const regNum = vendor.metadata?.vendorEntityData?.registrationNumber;
      if (regNum && regNum.trim() !== '') {
        const normalizedRegNum = regNum.trim().toLowerCase();
        if (registrationNumbers.has(normalizedRegNum)) {
          duplicateRegNums.add(normalizedRegNum);
          // Mark both vendors as invalid
          const existingVendor = registrationNumbers.get(normalizedRegNum);
          if (existingVendor) {
            invalidItems.push({
              email: existingVendor.inviteeEmail,
              error: `Duplicate registration number: ${regNum}`,
              row: existingVendor,
            });
          }
          invalidItems.push({
            email: vendor.inviteeEmail,
            error: `Duplicate registration number: ${regNum}`,
            row: vendor,
          });
        } else {
          registrationNumbers.set(normalizedRegNum, vendor);
        }
      }
    }

    // Filter out vendors with duplicate registration numbers
    const validPrimaryVendors = primaryVendors.filter((vendor) => {
      const regNum = vendor.metadata?.vendorEntityData?.registrationNumber;
      if (!regNum || regNum.trim() === '') return true; // Allow vendors without registration numbers
      return !duplicateRegNums.has(regNum.trim().toLowerCase());
    });

    // Process non-vendor invitations (no special handling needed)
    validItems.push(...nonVendors);

    // Process valid primary vendors (duplicates already filtered out)
    validItems.push(...validPrimaryVendors);

    // Sort to ensure primary vendors are processed before their team members
    validItems.sort((a, b) => {
      // Primary vendors first
      if (a.metadata?.isPrimaryVendor && !b.metadata?.isPrimaryVendor) return -1;
      if (!a.metadata?.isPrimaryVendor && b.metadata?.isPrimaryVendor) return 1;

      // Then team members, but group them by their CSV group ID
      if (a.metadata?.isVendorTeamMember && b.metadata?.isVendorTeamMember) {
        return (a.metadata?.csvGroupId || '').localeCompare(b.metadata?.csvGroupId || '');
      }

      // Team members after primary vendors
      if (a.metadata?.isVendorTeamMember && !b.metadata?.isVendorTeamMember) return 1;
      if (!a.metadata?.isVendorTeamMember && b.metadata?.isVendorTeamMember) return -1;

      // Others maintain original order
      return 0;
    });

    return {
      validItems,
      invalidItems,
    };
  };
}
