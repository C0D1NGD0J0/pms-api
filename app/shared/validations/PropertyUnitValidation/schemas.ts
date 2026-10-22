import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { UNIT_FLOOR_RANGE } from '@utils/constants';
import { PropertyUnitDAO, PropertyDAO } from '@dao/index';

import { shortUidString, optionalBlank } from '../UtilsValidation';

const getContainer = async () => {
  const { container } = await import('@di/setup');
  return container;
};
import {
  PropertyUnitInspectionStatusEnum,
  PropertyUnitStatusEnum,
  PropertyUnitTypeEnum,
  DocumentStatusEnum,
  DocumentTypeEnum,
} from '@interfaces/propertyUnit.interface';

export const isValidResource = async (resourceName: 'property' | 'propertyUnit', filter: any) => {
  const { propertyDAO }: { propertyDAO: PropertyDAO } = (await getContainer()).cradle;
  try {
    if (resourceName === 'property') {
      if (!filter.pid && !filter.id) {
        return false;
      }
      if (filter.id && isValidObjectId(filter.id)) {
        const property = await propertyDAO.findFirst({ _id: filter.id, deletedAt: null });
        return !!property;
      }
      if (filter.pid) {
        const property = await propertyDAO.findFirst({ pid: filter.pid, deletedAt: null });
        return !!property;
      }
    } else if (resourceName === 'propertyUnit') {
      const { propertyUnitDAO }: { propertyUnitDAO: PropertyUnitDAO } = (await getContainer())
        .cradle;
      if (!filter.unitId && !filter.unitNumber) {
        return false;
      }
      if (filter.unitId && isValidObjectId(filter.unitId)) {
        const unit = await propertyUnitDAO.findFirst({ _id: filter.unitId, deletedAt: null });
        return !!unit;
      }
      if (filter.propertyId) {
        const unit = await propertyUnitDAO.findFirst({
          propertyId: filter.propertyId,
          deletedAt: null,
        });
        return !!unit;
      }
    }
    return false;
  } catch (error) {
    console.error('Error checking property existence', error);
    return false;
  }
};

const isUniqueUnitNumber = async (pid: string, unitNumber: string, unitId?: string) => {
  const {
    propertyUnitDAO,
    propertyDAO,
  }: { propertyUnitDAO: PropertyUnitDAO; propertyDAO: PropertyDAO } = (await getContainer()).cradle;
  try {
    const query: any = {
      unitNumber,
      propertyId: '',
      deletedAt: null,
    };

    const property = await propertyDAO.findFirst({ pid });
    if (!property) {
      return false;
    }

    if (unitId) {
      query._id = { $ne: unitId };
    }
    query.propertyId = property.id;
    const existingUnit = await propertyUnitDAO.findFirst(query);
    if (!existingUnit) {
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error checking unit number uniqueness', error);
    return false;
  }
};

const UnitTypeZodEnum = z.enum(Object.values(PropertyUnitTypeEnum) as [string, ...string[]]);
const UnitStatusZodEnum = z.enum(Object.values(PropertyUnitStatusEnum) as [string, ...string[]]);
const DocumentTypeZodEnum = z.enum(Object.values(DocumentTypeEnum) as [string, ...string[]]);
const DocumentStatusZodEnum = z.enum(Object.values(DocumentStatusEnum) as [string, ...string[]]);
const InspectionStatusZodEnum = z.enum(
  Object.values(PropertyUnitInspectionStatusEnum) as [string, ...string[]]
);

const SpecificationsSchema = z.object({
  totalArea: z.number().positive('Total area must be a positive number'),
  bedrooms: z.number().int().min(0, 'Bedrooms must be a non-negative integer').default(1),
  bathrooms: z.number().min(0, 'Bathrooms must be a non-negative number').default(1),
  maxOccupants: z.number().int().min(1, 'Maximum occupants must be at least 1').optional(),
});

const FeesSchema = z.object({
  currency: z.enum(['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'JPY', 'NGN']).default('USD'),
  rentAmount: z.coerce.number().min(0, 'Rent amount must be a non-negative number'),
  securityDeposit: z.coerce
    .number()
    .min(0, 'Security deposit must be a non-negative number')
    .default(0),
});

const UtilitiesSchema = z.object({
  water: z.boolean().default(false),
  trash: z.boolean().default(false),
  gas: z.boolean().default(false),
  heating: z.boolean().default(false),
  centralAC: z.boolean().default(false),
});

const AmenitiesSchema = z.object({
  airConditioning: z.boolean().default(false),
  washerDryer: z.boolean().default(false),
  dishwasher: z.boolean().default(false),
  parking: z.boolean().default(false),
  storage: z.boolean().default(false),
  cableTV: z.boolean().default(false),
  internet: z.boolean().default(false),
});

const UnitPhotoSchema = z.object({
  url: z.string().url('Invalid URL format for photo'),
  filename: z.string().optional(),
  key: z.string().optional(),
  caption: z.string().optional(),
  isPrimary: z.boolean().default(false),
  uploadedAt: z.coerce.date().default(() => new Date()),
  uploadedBy: z.string().optional(),
});

const UnitDocumentSchema = z.object({
  url: z.string().url('Invalid URL format for document'),
  key: z.string().optional(),
  status: DocumentStatusZodEnum.default('active'),
  documentType: DocumentTypeZodEnum,
  externalUrl: z.string().url('Invalid external URL format').optional(),
  uploadedAt: z.coerce.date().default(() => new Date()),
  uploadedBy: z.string().optional(),
  description: z.string().max(150, 'Description must be at most 150 characters').optional(),
  documentName: z.string().max(100, 'Document name must be at most 100 characters').optional(),
});

const InspectionAttachmentSchema = z.object({
  url: z.string().url('Invalid URL format for attachment'),
  filename: z.string(),
  key: z.string().optional(),
  uploadedAt: z.coerce.date().default(() => new Date()),
});

const InspectorSchema = z.object({
  name: z.string().trim().min(1, 'Inspector name is required'),
  contact: z.string().trim().min(1, 'Inspector contact is required'),
  company: z.string().trim().optional(),
});

export const UnitInspectionSchema = z.object({
  inspectionDate: z.coerce.date(),
  inspector: InspectorSchema,
  status: InspectionStatusZodEnum,
  notes: z.string().optional(),
  attachments: z.array(InspectionAttachmentSchema).optional(),
});

const PropertyUnitNoteSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Note title is required')
    .max(100, 'Note title cannot exceed 100 characters'),
  content: z
    .string()
    .trim()
    .min(1, 'Note content is required')
    .max(2000, 'Note content cannot exceed 2000 characters'),
  html: z.string().trim().max(10000, 'Note HTML cannot exceed 10000 characters').optional(),
  createdAt: z.union([z.date(), z.string()]).optional(),
  createdBy: z.string().optional(),
});

const UnitNumberSchema = z
  .string()
  .min(1, 'Unit number must not be empty')
  .max(20, 'Unit number must be at most 20 characters');

// negative floors are basements, 0 is the ground floor
const UnitFloorSchema = z
  .number()
  .int()
  .min(UNIT_FLOOR_RANGE.min, `Floor cannot be less than ${UNIT_FLOOR_RANGE.min}`)
  .max(UNIT_FLOOR_RANGE.max, `Floor cannot be greater than ${UNIT_FLOOR_RANGE.max}`);

const BaseUnitSchema = z.object({
  unitNumber: UnitNumberSchema,
  unitType: UnitTypeZodEnum,
  status: UnitStatusZodEnum.default('available'),
  floor: UnitFloorSchema.default(1),
  description: z.string().max(500, 'Description must be at most 500 characters').optional(),
  isActive: z.boolean().default(true),
  // Optional user uid: must be an employee of this client, else the property's manager is used
  managedBy: optionalBlank(shortUidString),
  fees: FeesSchema,
  specifications: SpecificationsSchema,
  utilities: UtilitiesSchema.optional(),
  amenities: AmenitiesSchema.optional(),
  media: z
    .object({
      photos: z.array(UnitPhotoSchema).optional(),
    })
    .optional(),
  documents: z.array(UnitDocumentSchema).optional(),
  inspections: z.array(UnitInspectionSchema).optional(),
  notes: z.array(PropertyUnitNoteSchema).optional(),
  puid: z.string().optional(),
});

export const CreateUnitSchema = BaseUnitSchema.extend({
  pid: z.string().refine(async (pid) => await isValidResource('property', { pid }), {
    message: 'Property does not exist',
  }),
  cuid: z.string(),
}).superRefine(async (data, ctx) => {
  const isUnique = await isUniqueUnitNumber(data.pid, data.unitNumber);
  if (!isUnique) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `A unit with number '${data.unitNumber}' already exists for this property`,
      path: ['unitNumber'],
    });
  }
});

const CreateUnitsSchema = z.object({
  units: z
    .array(BaseUnitSchema)
    .min(1, 'At least one unit is required')
    .max(20, 'Maximum 20 units allowed. For bulk operations, please use CSV upload instead.'),
  pid: z.string().refine(async (pid) => await isValidResource('property', { pid }), {
    message: 'Property does not exist',
  }),
  cuid: z.string(),
});

export const CreateUnitsSchemaRefined = CreateUnitsSchema.superRefine(async (data, ctx) => {
  if ('units' in data) {
    const unitNumbers = data.units.map((unit) => unit.unitNumber);

    // duplicates within the batch
    const duplicates = unitNumbers.filter((num, index) => unitNumbers.indexOf(num) !== index);
    if (duplicates.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate unit numbers found in batch: ${duplicates.join(', ')}`,
        path: ['units'],
      });
    }

    // Check for existing units in the property
    for (let i = 0; i < data.units.length; i++) {
      const unit = data.units[i];

      // Check uniqueness
      const isUnique = await isUniqueUnitNumber(data.pid, unit.unitNumber);
      if (!isUnique) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `A unit with number '${unit.unitNumber}' already exists for this property`,
          path: ['units', i, 'unitNumber'],
        });
      }
    }
  }
});

/**
 * Partial update: only fields PropertyUnitService.updatePropertyUnit applies
 * (HIGH_IMPACT_UNIT_FIELDS + OPERATIONAL_UNIT_FIELDS). Server-owned fields (id, propertyId,
 * cuid, createdBy, currentLease, ...) are stripped. Unit-number uniqueness is enforced by the
 * service, which knows the unit being edited, and by the model's unique index.
 * Array fields (media, documents, inspections, notes) have dedicated endpoints.
 */
export const UpdateUnitSchema = z.object({
  unitNumber: UnitNumberSchema.optional(),
  status: UnitStatusZodEnum.optional(),
  floor: UnitFloorSchema.optional(),
  unitType: UnitTypeZodEnum.optional(),
  isActive: z.boolean().optional(),
  // user uid; the service checks it is an employee connected to this client
  managedBy: optionalBlank(shortUidString),
  description: BaseUnitSchema.shape.description,
  // currency must match the property's (enforced by the service)
  fees: FeesSchema.partial().optional(),
  specifications: SpecificationsSchema.partial().optional(),
  utilities: UtilitiesSchema.optional(),
  amenities: AmenitiesSchema.optional(),
});

export const UpdateUnitStatusSchema = z.object({
  status: UnitStatusZodEnum,
});

export const ApproveUnitChangesSchema = z.object({
  notes: z.string().trim().max(500, 'Approval notes must be at most 500 characters').optional(),
});

export const RejectUnitChangesSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'Rejection reason is required')
    .max(500, 'Rejection reason must be at most 500 characters'),
});

export const UnitFilterSchema = z.object({
  propertyId: z.string().optional(),
  status: UnitStatusZodEnum.optional(),
  type: UnitTypeZodEnum.optional(),
  priceRange: z
    .object({
      min: z.number().min(0).optional(),
      max: z.number().min(0).optional(),
    })
    .optional(),
  areaRange: z
    .object({
      min: z.number().min(0).optional(),
      max: z.number().min(0).optional(),
    })
    .optional(),
  room: z.union([z.number().min(0), z.literal('any')]).optional(),
  bathrooms: z.union([z.number().min(0), z.literal('any')]).optional(),
  floor: z.union([z.number(), z.literal('any')]).optional(),
  amenities: z.array(z.string()).optional(),
  utilities: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  searchTerm: z.string().optional(),
  dateRange: z
    .object({
      field: z.enum(['createdAt', 'updatedAt', 'lastInspectionDate']),
      start: z.union([z.coerce.date(), z.string()]).optional(),
      end: z.union([z.coerce.date(), z.string()]).optional(),
    })
    .optional(),
});

export const PaginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(10),
  sort: z
    .record(z.enum(['1', '-1']).or(z.union([z.literal(1), z.literal(-1)])))
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      return Object.entries(val).reduce(
        (acc, [key, value]) => {
          acc[key] = typeof value === 'string' ? parseInt(value) : value;
          return acc;
        },
        {} as Record<string, number>
      );
    }),
});

export const UnitFilterQuerySchema = z.object({
  filters: UnitFilterSchema.optional().nullable(),
  pagination: PaginationSchema,
});

export const UploadUnitMediaSchema = z.object({
  mediaType: z.enum(['photo', 'document']).default('photo'),
  description: z.string().max(150, 'Description must be at most 150 characters').optional(),
  documentType: DocumentTypeZodEnum.optional(),
  documentName: z.string().max(100, 'Document name must be at most 100 characters').optional(),
  isPrimary: z.boolean().default(false),
});

export const UnitExistsSchema = z
  .object({
    propertyId: z
      .string()
      .refine(async (propertyId) => await isValidResource('propertyUnit', { propertyId }), {
        message: 'Property does not exist',
      }),
    unitNumber: z.string().min(1, 'Unit number must not be empty'),
  })
  .superRefine(async (data, ctx) => {
    const isUnique = await isUniqueUnitNumber(data.unitNumber, data.propertyId);
    if (isUnique) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Unit does not exist for this property',
        path: ['unitNumber'],
      });
    }
  });

// Unit Number Suggestion Schema
export const UnitNumberSuggestionSchema = z.object({
  propertyId: z
    .string()
    .refine(async (propertyId) => await isValidResource('propertyUnit', { propertyId }), {
      message: 'Property does not exist',
    }),
  pattern: z
    .enum([
      'sequential',
      'floor_based',
      'alpha_numeric',
      'wing_unit',
      'building_unit',
      'suite',
      'custom',
    ])
    .optional(),
  customPrefix: z.string().max(10, 'Custom prefix must be at most 10 characters').optional(),
  currentFloor: UnitFloorSchema.default(1),
  suggestedNumber: z.string().optional(),
});

// Pattern Validation Schema
export const PatternValidationSchema = z.object({
  unitNumber: z.string().min(1, 'Unit number must not be empty'),
  floor: UnitFloorSchema,
});

// Batch Pattern Validation Schema
export const BatchPatternValidationSchema = z.object({
  units: z
    .array(
      z.object({
        unitNumber: z.string().min(1, 'Unit number must not be empty'),
        floor: UnitFloorSchema,
        unitType: z.string(),
      })
    )
    .min(1, 'At least one unit is required'),
});

// CSV Schema for property unit imports
export const PropertyUnitCsvSchema = z
  .object({
    cuid: z.string().min(1, 'Client ID is required'),
    pid: z.string().min(1, 'Property ID is required'),
    unitNumber: z
      .string()
      .min(1, 'Unit number must not be empty')
      .max(20, 'Unit number must be at most 20 characters'),
    floor: z.coerce
      .number({ invalid_type_error: 'Floor is required and must be a number' })
      .int()
      .min(UNIT_FLOOR_RANGE.min, `Floor cannot be less than ${UNIT_FLOOR_RANGE.min}`)
      .max(UNIT_FLOOR_RANGE.max, `Floor cannot be greater than ${UNIT_FLOOR_RANGE.max}`),
    unitType: UnitTypeZodEnum,
    status: UnitStatusZodEnum,
    description: z.string().max(500, 'Description must be at most 500 characters').optional(),

    // Specifications
    specifications_totalArea: z.coerce
      .number({ invalid_type_error: 'Total area is required and must be a number' })
      .positive('Total area must be a positive number'),
    specifications_bedrooms: z.coerce
      .number()
      .int()
      .min(0, 'Bedrooms must be a non-negative integer')
      .optional(),
    specifications_bathrooms: z.coerce
      .number()
      .min(0, 'Bathrooms must be a non-negative number')
      .optional(),
    specifications_maxOccupants: z.coerce
      .number()
      .int()
      .min(1, 'Maximum occupants must be at least 1')
      .optional(),

    // Fees
    fees_rentAmount: z.coerce
      .number({ invalid_type_error: 'Rent amount is required and must be a number' })
      .min(0, 'Rent amount must be a non-negative number'),
    fees_securityDeposit: z.coerce
      .number({ invalid_type_error: 'Security deposit is required and must be a number' })
      .min(0, 'Security deposit must be a non-negative number'),

    // Amenities - using boolean validation with transform
    amenities_airConditioning: z
      .union([z.boolean(), z.string(), z.number()])
      .optional()
      .transform((val) => {
        if (typeof val === 'boolean') return val;
        if (typeof val === 'string') {
          const lower = val.toLowerCase();
          return lower === 'true' || lower === '1' || lower === 'yes';
        }
        if (typeof val === 'number') return val === 1;
        return false;
      }),
    amenities_washerDryer: z
      .union([z.boolean(), z.string(), z.number()])
      .optional()
      .transform((val) => {
        if (typeof val === 'boolean') return val;
        if (typeof val === 'string') {
          const lower = val.toLowerCase();
          return lower === 'true' || lower === '1' || lower === 'yes';
        }
        if (typeof val === 'number') return val === 1;
        return false;
      }),
    amenities_dishwasher: z
      .union([z.boolean(), z.string(), z.number()])
      .optional()
      .transform((val) => {
        if (typeof val === 'boolean') return val;
        if (typeof val === 'string') {
          const lower = val.toLowerCase();
          return lower === 'true' || lower === '1' || lower === 'yes';
        }
        if (typeof val === 'number') return val === 1;
        return false;
      }),
    amenities_parking: z
      .union([z.boolean(), z.string(), z.number()])
      .optional()
      .transform((val) => {
        if (typeof val === 'boolean') return val;
        if (typeof val === 'string') {
          const lower = val.toLowerCase();
          return lower === 'true' || lower === '1' || lower === 'yes';
        }
        if (typeof val === 'number') return val === 1;
        return false;
      }),
    amenities_cableTV: z
      .union([z.boolean(), z.string(), z.number()])
      .optional()
      .transform((val) => {
        if (typeof val === 'boolean') return val;
        if (typeof val === 'string') {
          const lower = val.toLowerCase();
          return lower === 'true' || lower === '1' || lower === 'yes';
        }
        if (typeof val === 'number') return val === 1;
        return false;
      }),
    amenities_internet: z
      .union([z.boolean(), z.string(), z.number()])
      .optional()
      .transform((val) => {
        if (typeof val === 'boolean') return val;
        if (typeof val === 'string') {
          const lower = val.toLowerCase();
          return lower === 'true' || lower === '1' || lower === 'yes';
        }
        if (typeof val === 'number') return val === 1;
        return false;
      }),
    amenities_storage: z
      .union([z.boolean(), z.string(), z.number()])
      .optional()
      .transform((val) => {
        if (typeof val === 'boolean') return val;
        if (typeof val === 'string') {
          const lower = val.toLowerCase();
          return lower === 'true' || lower === '1' || lower === 'yes';
        }
        if (typeof val === 'number') return val === 1;
        return false;
      }),

    // Utilities
    utilities_water: z
      .union([z.boolean(), z.string(), z.number()])
      .optional()
      .transform((val) => {
        if (typeof val === 'boolean') return val;
        if (typeof val === 'string') {
          const lower = val.toLowerCase();
          return lower === 'true' || lower === '1' || lower === 'yes';
        }
        if (typeof val === 'number') return val === 1;
        return false;
      }),
    utilities_centralAC: z
      .union([z.boolean(), z.string(), z.number()])
      .optional()
      .transform((val) => {
        if (typeof val === 'boolean') return val;
        if (typeof val === 'string') {
          const lower = val.toLowerCase();
          return lower === 'true' || lower === '1' || lower === 'yes';
        }
        if (typeof val === 'number') return val === 1;
        return false;
      }),
    utilities_heating: z
      .union([z.boolean(), z.string(), z.number()])
      .optional()
      .transform((val) => {
        if (typeof val === 'boolean') return val;
        if (typeof val === 'string') {
          const lower = val.toLowerCase();
          return lower === 'true' || lower === '1' || lower === 'yes';
        }
        if (typeof val === 'number') return val === 1;
        return false;
      }),
    utilities_gas: z
      .union([z.boolean(), z.string(), z.number()])
      .optional()
      .transform((val) => {
        if (typeof val === 'boolean') return val;
        if (typeof val === 'string') {
          const lower = val.toLowerCase();
          return lower === 'true' || lower === '1' || lower === 'yes';
        }
        if (typeof val === 'number') return val === 1;
        return false;
      }),
    utilities_trash: z
      .union([z.boolean(), z.string(), z.number()])
      .optional()
      .transform((val) => {
        if (typeof val === 'boolean') return val;
        if (typeof val === 'string') {
          const lower = val.toLowerCase();
          return lower === 'true' || lower === '1' || lower === 'yes';
        }
        if (typeof val === 'number') return val === 1;
        return false;
      }),
  })
  .superRefine((data, ctx) => {
    // Residential units are leased by their rooms, so the counts must be stated
    // (a studio is 0 bedrooms); other unit types don't have them
    if (data.unitType !== 'residential') return;
    if (data.specifications_bedrooms === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Bedrooms are required for a residential unit (use 0 for a studio)',
        path: ['specifications_bedrooms'],
      });
    }
    if (data.specifications_bathrooms === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Bathrooms are required for a residential unit',
        path: ['specifications_bathrooms'],
      });
    }
  });
