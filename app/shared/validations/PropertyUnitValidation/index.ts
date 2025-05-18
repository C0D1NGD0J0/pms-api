import { CreateUnitSchemaWithValidation, UpdateUnitSchema } from './schemas';

export class PropertyUnitValidations {
  static updateUnit = UpdateUnitSchema;
  static createUnit = CreateUnitSchemaWithValidation;
  static inspectUnit = CreateUnitSchemaWithValidation;
}
