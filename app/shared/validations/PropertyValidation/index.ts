import { ValidateCidSchema } from '../UtilsValidation';
import {
  CreatePropertySchemaWithValidation,
  PropertyClientRelationshipSchema,
  AddressValidationSchema,
  UpdateOccupancySchema,
  UpdatePropertySchema,
  PropertySearchSchema,
  PropertyCsvSchema,
} from './schema';

export class PropertyValidations {
  static search = PropertySearchSchema;
  static propertyCsv = PropertyCsvSchema;
  static validateCid = ValidateCidSchema;
  static updateProperty = UpdatePropertySchema;
  static updateOccupancy = UpdateOccupancySchema;
  static validateAddress = AddressValidationSchema;
  static create = CreatePropertySchemaWithValidation;
  static validatePropertyAndClientIds = PropertyClientRelationshipSchema;
}
