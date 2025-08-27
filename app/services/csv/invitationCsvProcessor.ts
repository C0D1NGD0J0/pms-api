import { z } from 'zod';
import { ICurrentUser } from '@interfaces/user.interface';
import { InvitationDAO, ClientDAO, UserDAO } from '@dao/index';
import { IInvitationData } from '@interfaces/invitation.interface';
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
  userDAO: UserDAO;
}

interface InvitationProcessingContext {
  userId: ICurrentUser['sub'];
  cuid: string;
}

// Extract the input type (before transformation) from the CSV schema
// This gives us the flattened CSV field names, not the nested output structure
type InvitationCsvInputType = z.input<typeof InvitationValidations.invitationCsv>;

export class InvitationCsvProcessor {
  private readonly invitationDAO: InvitationDAO;
  private readonly clientDAO: ClientDAO;
  private readonly userDAO: UserDAO;
  private transformedDataCache = new Map<number, IInvitationCsvData>();

  constructor({ invitationDAO, clientDAO, userDAO }: IConstructor) {
    this.invitationDAO = invitationDAO;
    this.clientDAO = clientDAO;
    this.userDAO = userDAO;
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
    // Clear any existing cache data from previous uploads
    this.transformedDataCache.clear();

    const client = await this.clientDAO.getClientByCuid(context.cuid);
    if (!client) {
      throw new Error(`Client with ID ${context.cuid} not found`);
    }

    try {
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
    } finally {
      // Ensure cache is always cleared after processing, regardless of success or failure
      this.transformedDataCache.clear();
    }
  }

  private validateInvitationRow = async (
    row: any,
    context: InvitationProcessingContext,
    rowNumber: number
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

      // Cache the transformed data for use in the transform step
      this.transformedDataCache.set(rowNumber, transformedData);

      // check if user already exists and has access to this client
      const existingUser = await this.userDAO.getUserWithClientAccess(
        transformedData.inviteeEmail,
        context.cuid
      );

      if (existingUser) {
        // clean up cache since validation failed
        this.transformedDataCache.delete(rowNumber);
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
        // Clean up cache since validation failed
        this.transformedDataCache.delete(rowNumber);
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
        // Clean up cache since validation failed
        this.transformedDataCache.delete(rowNumber);
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

      return {
        isValid: true,
        errors: [],
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
    rowNumber: number
  ): Promise<IInvitationCsvData> => {
    // Get the transformed data from cache (set during validation)
    const transformedData = this.transformedDataCache.get(rowNumber);
    if (!transformedData) {
      // This should never happen with the fixed flow, but provide a descriptive error
      const cacheKeys = Array.from(this.transformedDataCache.keys());
      throw new Error(
        `No transformed data found for row ${rowNumber}. Available cache keys: [${cacheKeys.join(', ')}]. ` +
          'This indicates a validation/transform flow synchronization issue.'
      );
    }

    // Clean up the cache for memory efficiency
    this.transformedDataCache.delete(rowNumber);

    return transformedData;
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

    // Separate primary vendors and team members for two-pass processing
    const primaryVendors = invitations.filter(
      (inv) => inv.role === 'vendor' && inv.metadata?.isPrimaryVendor
    );
    const vendorTeamMembers = invitations.filter(
      (inv) => inv.role === 'vendor' && inv.metadata?.isVendorTeamMember
    );
    const nonVendors = invitations.filter((inv) => inv.role !== 'vendor');

    // Group team members by their CSV group ID to validate they have corresponding primary vendors
    const teamMembersByGroup = new Map<string, any[]>();
    for (const teamMember of vendorTeamMembers) {
      const csvGroupId = teamMember.metadata?.csvGroupId;
      if (!csvGroupId) {
        invalidItems.push({
          email: teamMember.inviteeEmail,
          error: 'Vendor team members must have a group identifier (linkedVendorId)',
          row: teamMember,
        });
        continue;
      }

      if (!teamMembersByGroup.has(csvGroupId)) {
        teamMembersByGroup.set(csvGroupId, []);
      }
      teamMembersByGroup.get(csvGroupId)!.push(teamMember);
    }

    // Validate that each team member group has a corresponding primary vendor
    for (const [csvGroupId, members] of teamMembersByGroup) {
      const hasPrimaryVendor = primaryVendors.some((pv) => pv.metadata?.csvGroupId === csvGroupId);

      if (!hasPrimaryVendor) {
        for (const member of members) {
          invalidItems.push({
            email: member.inviteeEmail,
            error: `No primary vendor found for group ${csvGroupId}. Team members require a primary vendor in the same CSV.`,
            row: member,
          });
        }
      } else {
        validItems.push(...members);
      }
    }

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
