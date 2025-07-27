import {
  getInvitationsQuerySchema,
  processPendingQuerySchema,
  acceptInvitationSchema,
  resendInvitationSchema,
  revokeInvitationSchema,
  updateInvitationSchema,
  invitationTokenSchema,
  sendInvitationSchema,
  invitationCsvSchema,
  iuidSchema,
} from './schemas';

export class InvitationValidations {
  static acceptInvitation = acceptInvitationSchema;
  static getInvitations = getInvitationsQuerySchema;
  static invitationCsv = invitationCsvSchema;
  static invitationToken = invitationTokenSchema;
  static iuid = iuidSchema;
  static processPending = processPendingQuerySchema;
  static resendInvitation = resendInvitationSchema;
  static revokeInvitation = revokeInvitationSchema;
  static sendInvitation = sendInvitationSchema;
  static updateInvitation = updateInvitationSchema;
}
