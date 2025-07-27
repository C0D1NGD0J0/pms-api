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
  private transformedDataCache = new Map<number, IInvitationData>();

  constructor({ invitationDAO, clientDAO, userDAO }: IConstructor) {
    this.invitationDAO = invitationDAO;
    this.clientDAO = clientDAO;
    this.userDAO = userDAO;
  }

  async validateCsv(
    filePath: string,
    context: InvitationProcessingContext
  ): Promise<{
    validInvitations: IInvitationData[];
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
        IInvitationData,
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
  ): Promise<IInvitationData> => {
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
    invitations: IInvitationData[],
    _context: InvitationProcessingContext
  ): Promise<{ validItems: IInvitationData[]; invalidItems: any[] }> => {
    // For now, just return the invitations as-is
    // In the future, we could add additional processing here
    // like email validation, duplicate checking across the batch, etc.
    return {
      validItems: invitations,
      invalidItems: [],
    };
  };
}
