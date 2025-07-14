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
    const client = await this.clientDAO.getClientBycuid(context.cuid);
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
    _rowNumber: number
  ): Promise<ICsvValidationResult> => {
    const rowWithContext = {
      ...row,
      cuid: context.cuid,
    };

    const validationResult =
      await InvitationValidations.invitationCsv.safeParseAsync(rowWithContext);

    if (validationResult.success) {
      // Check if user already exists and has access to this client
      const existingUser = await this.userDAO.getUserWithClientAccess(
        row.inviteeEmail,
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

      const client = await this.clientDAO.getClientBycuid(context.cuid);
      if (!client) {
        return {
          isValid: false,
          errors: [{ field: 'cuid', error: `Client with ID ${context.cuid} not found` }],
        };
      }

      // Check if there's already a pending invitation for this email and client
      const existingInvitation = await this.invitationDAO.findPendingInvitation(
        row.inviteeEmail,
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
    _context: InvitationProcessingContext
  ): Promise<IInvitationData> => {
    return {
      inviteeEmail: row.inviteeEmail?.trim().toLowerCase(),
      role: row.role,
      personalInfo: {
        firstName: row.firstName?.trim(),
        lastName: row.lastName?.trim(),
        phoneNumber: row.phoneNumber?.trim() || undefined,
      },
      metadata: {
        inviteMessage: row.inviteMessage?.trim() || undefined,
        expectedStartDate: row.expectedStartDate || undefined,
      },
    };
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
