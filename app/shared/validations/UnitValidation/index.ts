import { CreateUnitSchemaWithValidation, UpdateUnitSchema } from './schemas';

export class UnitValidations {
  static createUnit = CreateUnitSchemaWithValidation;
  static updateUnit = UpdateUnitSchema;
}
