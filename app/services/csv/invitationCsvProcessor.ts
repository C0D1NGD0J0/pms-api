import { ICurrentUser } from '@interfaces/user.interface';
import { InvitationDAO, ClientDAO, UserDAO } from '@dao/index';
import { IInvitationData } from '@interfaces/invitation.interface';
import { InvitationValidations } from '@shared/validations/InvitationValidation';
import { ICsvValidationResult, IInvalidCsvProperty } from '@interfaces/csv.interface';

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
    const client = await this.clientDAO.getClientByCuid(context.cuid);
    if (!client) {
      throw new Error(`Client with ID ${context.cuid} not found`);
    }

    const result = await BaseCSVProcessorService.processCsvFile<
      IInvitationData,
      InvitationProcessingContext
    >(filePath, {
      context,
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
    rowNumber: number
  ): Promise<ICsvValidationResult> => {
    const rowWithContext = {
      ...row,
      cuid: context.cuid,
    };

    const validationResult =
      await InvitationValidations.invitationCsv.safeParseAsync(rowWithContext);

    if (validationResult.success) {
      const transformedData = validationResult.data;

      // Cache the transformed data for use in the transform step
      this.transformedDataCache.set(rowNumber, transformedData);

      // Check if user already exists and has access to this client
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
    row: any,
    _context: InvitationProcessingContext,
    rowNumber: number
  ): Promise<IInvitationData> => {
    // Get the transformed data from cache (set during validation)
    const transformedData = this.transformedDataCache.get(rowNumber);
    if (!transformedData) {
      throw new Error(`No transformed data found for row ${rowNumber}`);
    }

    // Clean up the cache for memory efficiency
    this.transformedDataCache.delete(rowNumber);

    return transformedData;
  };

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
