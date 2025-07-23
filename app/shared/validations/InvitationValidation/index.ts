import {
  getInvitationsQuerySchema,
  processPendingQuerySchema,
  acceptInvitationSchema,
  revokeInvitationSchema,
  resendInvitationSchema,
  invitationTokenSchema,
  sendInvitationSchema,
  invitationCsvSchema,
  iuidSchema,
} from './schemas';

export class InvitationValidations {
  static sendInvitation = sendInvitationSchema;
  static acceptInvitation = acceptInvitationSchema;
  static revokeInvitation = revokeInvitationSchema;
  static resendInvitation = resendInvitationSchema;
  static getInvitations = getInvitationsQuerySchema;
  static invitationToken = invitationTokenSchema;
  static invitationCsv = invitationCsvSchema;
  static iuid = iuidSchema;
  static processPending = processPendingQuerySchema;
}
