import {
  UpdateOccupancySchema,
  CreatePropertySchema,
  UpdatePropertySchema,
  PropertySearchSchema,
  ValidateCidSchema,
  ValidateIdSchema,
} from './schema';

export class PropertyValidations {
  static create = CreatePropertySchema;
  static update = UpdatePropertySchema;
  static search = PropertySearchSchema;
  static getId = ValidateIdSchema;
  static validateCid = ValidateCidSchema;
  static updateOccupancy = UpdateOccupancySchema;
}
