import {
  CreatePropertySchemaWithValidation,
  PropertyClientRelationshipSchema,
  UpdateOccupancySchema,
  UpdatePropertySchema,
  PropertySearchSchema,
  ValidateCidSchema,
  PropertyCsvSchema,
  ValidateIdSchema,
} from './schema';

export class PropertyValidations {
  static getId = ValidateIdSchema;
  static update = UpdatePropertySchema;
  static search = PropertySearchSchema;
  static propertyCsv = PropertyCsvSchema;
  static validateCid = ValidateCidSchema;
  static updateOccupancy = UpdateOccupancySchema;
  static create = CreatePropertySchemaWithValidation;
  static validatePropertyAndClientIds = PropertyClientRelationshipSchema;
}
