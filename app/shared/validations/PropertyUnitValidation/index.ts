import { ValidateUnitPuid } from '../UtilsValidation';
import {
  BatchPatternValidationSchema,
  UnitNumberSuggestionSchema,
  CreateUnitsSchemaRefined,
  PatternValidationSchema,
  PropertyUnitCsvSchema,
  UploadUnitMediaSchema,
  UnitInspectionSchema,
  CreateUnitSchema,
  UpdateUnitSchema,
} from './schemas';

export class PropertyUnitValidations {
  static batchPatternValidation = BatchPatternValidationSchema;
  static createUnit = CreateUnitSchema;
  static createUnits = CreateUnitsSchemaRefined;
  static csvSchema = PropertyUnitCsvSchema;
  static inspectUnit = UnitInspectionSchema;
  static patternValidation = PatternValidationSchema;
  static unitNumberSuggestion = UnitNumberSuggestionSchema;
  static updateUnit = UpdateUnitSchema;
  static validatePuid = ValidateUnitPuid;
  static uploadUnitMedia = UploadUnitMediaSchema;
}
