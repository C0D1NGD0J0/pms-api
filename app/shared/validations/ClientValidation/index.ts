import { ValidateCuidSchema } from '../UtilsValidation';
import {
  EnterpriseClientValidationSchema,
  TenantDetailsIncludeQuerySchema,
  ClientIdentificationSchema,
  UpdateClientDetailsSchema,
  UpdateTenantProfileSchema,
  ClientSubscriptionSchema,
  FilteredUsersQuerySchema,
  ClientDisplayNameSchema,
  AssignDepartmentSchema,
  ClientSettingsSchema,
  CompanyProfileSchema,
  UserIdParamSchema,
  AssignRoleSchema,
  RoleParamSchema,
} from './schemas';

export class ClientValidations {
  static clientIdParam = ValidateCuidSchema;
  static userIdParam = UserIdParamSchema;
  static roleParam = RoleParamSchema;
  static assignRole = AssignRoleSchema;
  static assignDepartment = AssignDepartmentSchema;
  static updateSettings = ClientSettingsSchema;
  static updateProfile = CompanyProfileSchema;
  static updateIdentification = ClientIdentificationSchema;
  static updateSubscription = ClientSubscriptionSchema;
  static updateDisplayName = ClientDisplayNameSchema;
  static updateClientDetails = UpdateClientDetailsSchema;
  static filteredUsersQuery = FilteredUsersQuerySchema;
  static tenantDetailsIncludeQuery = TenantDetailsIncludeQuerySchema;
  static updateTenantProfile = UpdateTenantProfileSchema;
  static enterpriseValidation = EnterpriseClientValidationSchema;
}
