import {
  BatchPatternValidationSchema,
  UnitNumberSuggestionSchema,
  CreateUnitsSchemaRefined,
  PatternValidationSchema,
  UploadUnitMediaSchema,
  UnitInspectionSchema,
  CreateUnitSchema,
  UpdateUnitSchema,
  ValidateUnitId,
} from './schemas';

export class PropertyUnitValidations {
  static batchPatternValidation = BatchPatternValidationSchema;
  static createUnit = CreateUnitSchema;
  static createUnits = CreateUnitsSchemaRefined;
  static inspectUnit = UnitInspectionSchema;
  static patternValidation = PatternValidationSchema;
  static unitNumberSuggestion = UnitNumberSuggestionSchema;
  static updateUnit = UpdateUnitSchema;
  static validatePuid = ValidateUnitId;
  static uploadUnitMedia = UploadUnitMediaSchema;
}
