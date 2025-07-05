import {
  ClientIdentificationSchema,
  UpdateClientDetailsSchema,
  ClientSubscriptionSchema,
  ClientDisplayNameSchema,
  ClientSettingsSchema,
  CompanyProfileSchema,
  ClientIdParamSchema,
} from './schemas';

export class ClientValidations {
  static clientIdParam = ClientIdParamSchema;
  static updateSettings = ClientSettingsSchema;
  static updateProfile = CompanyProfileSchema;
  static updateIdentification = ClientIdentificationSchema;
  static updateSubscription = ClientSubscriptionSchema;
  static updateDisplayName = ClientDisplayNameSchema;
  static updateClientDetails = UpdateClientDetailsSchema;
}
