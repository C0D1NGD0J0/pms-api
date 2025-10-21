import { ValidatecuidSchema } from '../UtilsValidation';
import {
  TenantDetailsIncludeQuerySchema,
  ClientIdentificationSchema,
  UpdateClientDetailsSchema,
  UpdateTenantProfileSchema,
  ClientSubscriptionSchema,
  FilteredUsersQuerySchema,
  ClientDisplayNameSchema,
  ClientSettingsSchema,
  CompanyProfileSchema,
  UserIdParamSchema,
  AssignRoleSchema,
  RoleParamSchema,
} from './schemas';

export class ClientValidations {
  static clientIdParam = ValidatecuidSchema;
  static userIdParam = UserIdParamSchema;
  static roleParam = RoleParamSchema;
  static assignRole = AssignRoleSchema;
  static updateSettings = ClientSettingsSchema;
  static updateProfile = CompanyProfileSchema;
  static updateIdentification = ClientIdentificationSchema;
  static updateSubscription = ClientSubscriptionSchema;
  static updateDisplayName = ClientDisplayNameSchema;
  static updateClientDetails = UpdateClientDetailsSchema;
  static filteredUsersQuery = FilteredUsersQuerySchema;
  static tenantDetailsIncludeQuery = TenantDetailsIncludeQuerySchema;
  static updateTenantProfile = UpdateTenantProfileSchema;
}
