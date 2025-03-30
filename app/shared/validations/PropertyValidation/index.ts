import {
  CreatePropertySchemaWithValidation,
  PropertyClientRelationshipSchema,
  UpdateOccupancySchema,
  UpdatePropertySchema,
  PropertySearchSchema,
  ValidateCidSchema,
  ValidateIdSchema,
} from './schema';

export class PropertyValidations {
  static getId = ValidateIdSchema;
  static update = UpdatePropertySchema;
  static search = PropertySearchSchema;
  static validateCid = ValidateCidSchema;
  static updateOccupancy = UpdateOccupancySchema;
  static create = CreatePropertySchemaWithValidation;
  static validatePropertyAndClientIds = PropertyClientRelationshipSchema;
}
