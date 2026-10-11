import { z } from 'zod';

import { ValidateUnitPuid } from '../UtilsValidation';
import {
  BatchPatternValidationSchema,
  UnitNumberSuggestionSchema,
  ApproveUnitChangesSchema,
  CreateUnitsSchemaRefined,
  PatternValidationSchema,
  RejectUnitChangesSchema,
  UpdateUnitStatusSchema,
  PropertyUnitCsvSchema,
  UploadUnitMediaSchema,
  UnitInspectionSchema,
  CreateUnitSchema,
  UpdateUnitSchema,
} from './schemas';

export class PropertyUnitValidations {
  static approveUnitChanges = ApproveUnitChangesSchema;
  static batchPatternValidation = BatchPatternValidationSchema;
  static createUnit = CreateUnitSchema;
  static createUnits = CreateUnitsSchemaRefined;
  static csvSchema = PropertyUnitCsvSchema;
  static inspectUnit = UnitInspectionSchema;
  static patternValidation = PatternValidationSchema;
  static rejectUnitChanges = RejectUnitChangesSchema;
  static unitNumberSuggestion = UnitNumberSuggestionSchema;
  static updateUnit = UpdateUnitSchema;
  static updateUnitStatus = UpdateUnitStatusSchema;
  // validateRequest replaces req.params with the parsed result, so the mergeParams route keys
  // (cuid, pid) must be declared or the service loses them.
  static validatePuid = ValidateUnitPuid.extend({ cuid: z.string(), pid: z.string() });
  static uploadUnitMedia = UploadUnitMediaSchema;
}
