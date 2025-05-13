import {
  CreatePropertySchemaWithValidation,
  PropertyClientRelationshipSchema,
  AddressValidationSchema,
  UpdateOccupancySchema,
  UpdatePropertySchema,
  PropertySearchSchema,
  ValidateCidSchema,
  PropertyCsvSchema,
  ValidateIdSchema,
} from './schema';

export class PropertyValidations {
  static getId = ValidateIdSchema;
  static search = PropertySearchSchema;
  static propertyCsv = PropertyCsvSchema;
  static validateCid = ValidateCidSchema;
  static updateProperty = UpdatePropertySchema;
  static updateOccupancy = UpdateOccupancySchema;
  static validateAddress = AddressValidationSchema;
  static create = CreatePropertySchemaWithValidation;
  static validatePropertyAndClientIds = PropertyClientRelationshipSchema;
}
