import { z } from 'zod';
import { container } from '@di/setup';
import { PropertyDAO } from '@dao/index';
import {
  InspectionStatusEnum,
  DocumentStatusEnum,
  DocumentTypeEnum,
  UnitStatusEnum,
  UnitTypeEnum,
} from '@interfaces/propertyUnit.interface';

const isValidProperty = async (propertyId: string) => {
  const { propertyDAO }: { propertyDAO: PropertyDAO } = container.cradle;
  try {
    const property = await propertyDAO.findById(propertyId);
    return !!property;
  } catch (error) {
    console.error('Error checking property existence', error);
    return false;
  }
};

const isUniqueUnitNumber = async (unitNumber: string, propertyId: string, unitId?: string) => {
  const { unitDAO }: { unitDAO: any } = container.cradle;
  try {
    const query: any = {
      unitNumber,
      propertyId,
      deletedAt: null,
    };

    // Exclude current unit when updating
    if (unitId) {
      query._id = { $ne: unitId };
    }

    const existingUnit = await unitDAO.findFirst(query);
    return !existingUnit;
  } catch (error) {
    console.error('Error checking unit number uniqueness', error);
    return false;
  }
};

// Convert enum objects to Zod enums
const UnitTypeZodEnum = z.enum(Object.values(UnitTypeEnum) as [string, ...string[]]);
const UnitStatusZodEnum = z.enum(Object.values(UnitStatusEnum) as [string, ...string[]]);
const DocumentTypeZodEnum = z.enum(Object.values(DocumentTypeEnum) as [string, ...string[]]);
const DocumentStatusZodEnum = z.enum(Object.values(DocumentStatusEnum) as [string, ...string[]]);
const InspectionStatusZodEnum = z.enum(
  Object.values(InspectionStatusEnum) as [string, ...string[]]
);

// Unit Specifications Schema
const SpecificationsSchema = z.object({
  totalArea: z.number().positive('Total area must be a positive number'),
  bedrooms: z.number().int().min(0, 'Bedrooms must be a non-negative integer').default(1),
  bathrooms: z.number().min(0, 'Bathrooms must be a non-negative number').default(1),
  maxOccupants: z.number().int().min(1, 'Maximum occupants must be at least 1').optional(),
});

// Unit Fees Schema
const FeesSchema = z.object({
  currency: z.enum(['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'JPY']).default('USD'),
  rentAmount: z.number().min(0, 'Rent amount must be a non-negative number'),
  securityDeposit: z.number().min(0, 'Security deposit must be a non-negative number').default(0),
});

// Unit Utilities Schema
const UtilitiesSchema = z.object({
  water: z.boolean().default(false),
  gas: z.boolean().default(false),
  electricity: z.boolean().default(false),
  internet: z.boolean().default(false),
  trash: z.boolean().default(false),
  cableTV: z.boolean().default(false),
});

// Unit Amenities Schema
const AmenitiesSchema = z.object({
  airConditioning: z.boolean().default(false),
  heating: z.boolean().default(false),
  washerDryer: z.boolean().default(false),
  dishwasher: z.boolean().default(false),
  fireplace: z.boolean().default(false),
  hardwoodFloors: z.boolean().default(false),
  furnished: z.boolean().default(false),
  balcony: z.boolean().default(false),
  parking: z.boolean().default(false),
  storage: z.boolean().default(false),
  walkInCloset: z.boolean().default(false),
});

// Unit Photo Schema
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

const UnitInspectionSchema = z.object({
  inspectionDate: z.coerce.date(),
  inspector: z.string(),
  status: InspectionStatusZodEnum,
  notes: z.string().optional(),
  attachments: z.array(InspectionAttachmentSchema).optional(),
});

export const CreateUnitSchema = z.object({
  unitNumber: z
    .string()
    .min(1, 'Unit number must not be empty')
    .max(20, 'Unit number must be at most 20 characters'),
  propertyId: z.string().refine(async (id) => await isValidProperty(id), {
    message: 'Property does not exist',
  }),
  cid: z.string(),
  type: UnitTypeZodEnum,
  status: UnitStatusZodEnum.default('available'),
  floor: z
    .number()
    .int()
    .min(-5, 'Floor cannot be less than -5')
    .max(100, 'Floor cannot be greater than 100')
    .default(1),
  description: z.string().max(500, 'Description must be at most 500 characters').optional(),
  isActive: z.boolean().default(true),

  // Complex nested objects
  fees: FeesSchema,
  specifications: SpecificationsSchema,
  utilities: UtilitiesSchema.optional(),
  amenities: AmenitiesSchema.optional(),

  // Optional fields with sub-schemas
  media: z
    .object({
      photos: z.array(UnitPhotoSchema).optional(),
    })
    .optional(),

  documents: z.array(UnitDocumentSchema).optional(),
  inspections: z.array(UnitInspectionSchema).optional(),

  // References
  currentLease: z.string().optional(),

  // User tracking fields
  createdBy: z.string(),
  lastModifiedBy: z.string().optional(),
});

export const CreateUnitSchemaWithValidation = CreateUnitSchema.superRefine(async (data, ctx) => {
  if (data.unitNumber && data.propertyId) {
    const isUnique = await isUniqueUnitNumber(data.unitNumber, data.propertyId);
    if (!isUnique) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A unit with this number already exists for this property',
        path: ['unitNumber'],
      });
    }
  }
});

export const UpdateUnitSchema = CreateUnitSchema.partial()
  .extend({
    uid: z.string(),
  })
  .superRefine(async (data, ctx) => {
    if (data.unitNumber && data.propertyId && data.uid) {
      const isUnique = await isUniqueUnitNumber(data.unitNumber, data.propertyId, data.uid);
      if (!isUnique) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'A unit with this number already exists for this property',
          path: ['unitNumber'],
        });
      }
    }
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
  bedrooms: z.union([z.number().min(0), z.literal('any')]).optional(),
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

export const UnitExistsSchema = z
  .object({
    propertyId: z.string().refine(async (id) => await isValidProperty(id), {
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
