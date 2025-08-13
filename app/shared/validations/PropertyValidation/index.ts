import { ValidatecuidSchema } from '../UtilsValidation';
import {
  CreatePropertySchemaWithValidation,
  PropertyClientRelationshipSchema,
  GetAssignableUsersSchema,
  AddressValidationSchema,
  UpdateOccupancySchema,
  UpdatePropertySchema,
  PropertySearchSchema,
  PropertyCsvSchema,
} from './schema';

export class PropertyValidations {
  static search = PropertySearchSchema;
  static propertyCsv = PropertyCsvSchema;
  static validatecuid = ValidatecuidSchema;
  static updateProperty = UpdatePropertySchema;
  static updateOccupancy = UpdateOccupancySchema;
  static validateAddress = AddressValidationSchema;
  static create = CreatePropertySchemaWithValidation;
  static validatePropertyAndClientIds = PropertyClientRelationshipSchema;
  static getAssignableUsers = GetAssignableUsersSchema;
}
