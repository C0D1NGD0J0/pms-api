import {
  ClientIdentificationSchema,
  UpdateClientDetailsSchema,
  ClientSubscriptionSchema,
  ClientDisplayNameSchema,
  ClientSettingsSchema,
  CompanyProfileSchema,
  ClientIdParamSchema,
  UserIdParamSchema,
  AssignRoleSchema,
  RoleParamSchema,
} from './schemas';

export class ClientValidations {
  static clientIdParam = ClientIdParamSchema;
  static userIdParam = UserIdParamSchema;
  static roleParam = RoleParamSchema;
  static assignRole = AssignRoleSchema;
  static updateSettings = ClientSettingsSchema;
  static updateProfile = CompanyProfileSchema;
  static updateIdentification = ClientIdentificationSchema;
  static updateSubscription = ClientSubscriptionSchema;
  static updateDisplayName = ClientDisplayNameSchema;
  static updateClientDetails = UpdateClientDetailsSchema;
}
