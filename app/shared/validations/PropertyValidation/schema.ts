import { z } from 'zod';
import { container } from '@di/setup';
import { PropertyDAO, ClientDAO } from '@dao/index';
import { BaseCSVProcessorService } from '@services/csv/base';

const isUniqueAddress = async (address: string, clientId: string) => {
  const { propertyDAO }: { propertyDAO: PropertyDAO; clientDAO: ClientDAO } = container.cradle;
  try {
    const existingProperty = await propertyDAO.findFirst({
      address,
      cid: clientId,
      deletedAt: null,
    });
    return !existingProperty;
  } catch (error) {
    console.error('Error checking address uniqueness', error);
    return false;
  }
};

const PropertyTypeEnum = z.enum([
  'apartment',
  'house',
  'condominium',
  'townhouse',
  'commercial',
  'industrial',
]);

const PropertyStatusEnum = z.enum([
  'available',
  'occupied',
  'maintenance',
  'construction',
  'inactive',
]);

const OccupancyStatusEnum = z.enum(['vacant', 'occupied', 'partially_occupied']);

const SpecificationsSchema = z.object({
  totalArea: z.number().positive('Total area must be a positive number'),
  lotSize: z.number().positive('Lot size must be a positive number').optional(),
  bedrooms: z.number().int().min(0, 'Bedrooms must be a non-negative integer').optional(),
  bathrooms: z.number().min(0, 'Bathrooms must be a non-negative number').optional(),
  floors: z.number().int().min(1, 'Floors must be at least 1').optional(),
  garageSpaces: z.number().int().min(0, 'Garage spaces must be a non-negative integer').optional(),
  maxOccupants: z.number().int().min(1, 'Maximum occupants must be at least 1').optional(),
});

const FinancialDetailsSchema = z.object({
  purchasePrice: z.number().positive('Purchase price must be a positive number').optional(),
  purchaseDate: z.coerce
    .date({
      errorMap: (issue, { defaultError }) => ({
        message:
          issue.code === z.ZodIssueCode.invalid_date
            ? 'Invalid date format for purchase date'
            : defaultError,
      }),
    })
    .optional(),
  marketValue: z.number().positive('Market value must be a positive number').optional(),
  propertyTax: z.number().min(0, 'Property tax must be a non-negative number').optional(),
  lastAssessmentDate: z.coerce
    .date({
      errorMap: (issue, { defaultError }) => ({
        message:
          issue.code === z.ZodIssueCode.invalid_date
            ? 'Invalid date format for last-assesment date'
            : defaultError,
      }),
    })
    .optional(),
});

const UtilitiesSchema = z.object({
  water: z.boolean().default(false),
  gas: z.boolean().default(false),
  electricity: z.boolean().default(false),
  internet: z.boolean().default(false),
  trash: z.boolean().default(false),
  cableTV: z.boolean().default(false),
});

const InteriorAmenitiesSchema = z.object({
  airConditioning: z.boolean().default(false),
  heating: z.boolean().default(false),
  washerDryer: z.boolean().default(false),
  dishwasher: z.boolean().default(false),
  fridge: z.boolean().default(false),
  furnished: z.boolean().default(false),
  storageSpace: z.boolean().default(false),
});

const CommunityAmenitiesSchema = z.object({
  petFriendly: z.boolean().default(false),
  swimmingPool: z.boolean().default(false),
  fitnessCenter: z.boolean().default(false),
  elevator: z.boolean().default(false),
  parking: z.boolean().default(false),
  securitySystem: z.boolean().default(false),
  laundryFacility: z.boolean().default(false),
  doorman: z.boolean().default(false),
});

const DocumentPhotoSchema = z.object({
  url: z.string().url('Invalid URL format for photo'),
  filename: z.string().optional(),
  key: z.string().optional(),
  uploadedAt: z.coerce
    .date({
      errorMap: (issue, { defaultError }) => ({
        message:
          issue.code === z.ZodIssueCode.invalid_date
            ? 'Invalid date format for uploaded date'
            : defaultError,
      }),
    })
    .optional(),
});

const PropertyDocumentSchema = z.object({
  photos: z.array(DocumentPhotoSchema).optional(),
  documentType: z.enum(['deed', 'tax', 'insurance', 'inspection', 'other']).optional(),
  description: z.string().optional(),
});

const CreatePropertySchema = z.object({
  name: z
    .string()
    .min(3, 'Property name must be at least 3 characters')
    .max(100, 'Property name must be at most 100 characters'),
  propertyType: PropertyTypeEnum,
  status: PropertyStatusEnum.default('available'),
  managedBy: z.string().optional(),
  yearBuilt: z
    .number()
    .int()
    .min(1800, 'Year built must be at least 1800')
    .max(
      new Date().getFullYear() + 10,
      `Year built must be at most ${new Date().getFullYear() + 10}`
    )
    .optional(),
  address: z.string().min(5, 'Address must be at least 5 characters'),
  description: z.string().max(2000, 'Description must be at most 2000 characters').optional(),
  cid: z.string(),
  specifications: SpecificationsSchema,
  financialDetails: FinancialDetailsSchema.optional(),
  utilities: UtilitiesSchema.optional(),
  interiorAmenities: InteriorAmenitiesSchema.optional(),
  communityAmenities: CommunityAmenitiesSchema.optional(),
  documents: z.array(PropertyDocumentSchema).optional(),
});

export const CreatePropertySchemaWithValidation = CreatePropertySchema.superRefine(
  async (data, ctx) => {
    if (data.address && data.cid) {
      const isUnique = await isUniqueAddress(data.address, data.cid);
      if (!isUnique) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'A property with this address already exists for this client.',
          path: ['address'],
        });
      }
    }
  }
);

export const UpdatePropertySchema = CreatePropertySchema.partial().omit({ cid: true }).extend({
  id: z.string(),
});

export const PropertySearchSchema = z.object({
  query: z.string().optional(),
  clientId: z.string(),
  status: z.array(PropertyStatusEnum).optional(),
  propertyType: z.array(PropertyTypeEnum).optional(),
  occupancyStatus: z.array(OccupancyStatusEnum).optional(),
  minArea: z.number().positive().optional(),
  maxArea: z.number().positive().optional(),
  minPrice: z.number().positive().optional(),
  maxPrice: z.number().positive().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(10),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export const ValidateIdSchema = z.object({
  id: z.string().refine(
    async (id) => {
      const { propertyDAO }: { propertyDAO: PropertyDAO } = container.cradle;
      const property = await propertyDAO.findById(id);
      return !!property;
    },
    {
      message: 'Invalid params detected in the request.',
    }
  ),
});

export const ValidateCidSchema = z.object({
  cid: z.string().refine(
    async (id) => {
      const { clientDAO }: { clientDAO: ClientDAO } = container.cradle;
      const client = await clientDAO.findFirst({ cid: id });
      return !!client;
    },
    {
      message: 'Invalid params detected in the request.',
    }
  ),
});

export const UpdateOccupancySchema = z.object({
  propertyId: z.string().refine(
    async (id) => {
      const { propertyDAO }: { propertyDAO: PropertyDAO } = container.cradle;
      const property = await propertyDAO.findById(id);
      return !!property;
    },
    {
      message: 'Property not found',
    }
  ),
  occupancyStatus: OccupancyStatusEnum,
  occupancyLimit: z.number().min(0).max(100),
});

const PropertyClientRelationship = z.object({
  cid: z.string().trim().min(1, 'Client ID is required'),
  propertyId: z.string().trim().min(1, 'Property ID is required'),
});

export const PropertyClientRelationshipSchema = PropertyClientRelationship.superRefine(
  async (data, ctx) => {
    const { propertyDAO }: { propertyDAO: PropertyDAO } = container.cradle;
    const property = await propertyDAO.findFirst({
      _id: data.propertyId,
      cid: data.cid,
      deletedAt: null,
    });

    if (!property) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Property not found for the given client ID.',
        path: ['propertyId'],
      });
      return false;
    }

    return true;
  }
);

export const PropertyCsvSchema = z.object({
  name: z
    .string()
    .min(3, 'Property name must be at least 3 characters')
    .max(100, 'Property name must be at most 100 characters'),
  address: z.string().min(5, 'Address must be at least 5 characters'),
  propertyType: PropertyTypeEnum,
  status: PropertyStatusEnum.optional().default('available'),
  occupancyStatus: OccupancyStatusEnum.optional().default('vacant'),
  occupancyLimit: z.coerce.number().min(0).max(100).optional(),
  yearBuilt: z.coerce
    .number()
    .int()
    .min(1800, 'Year built must be at least 1800')
    .max(
      new Date().getFullYear() + 10,
      `Year built must be at most ${new Date().getFullYear() + 10}`
    )
    .optional(),
  managedBy: z.string().optional(),
  description_text: z.string().max(2000, 'Description must be at most 2000 characters').optional(),
  description_html: z.string().max(2000, 'Description must be at most 2000 characters').optional(),

  // Specifications
  specifications_totalArea: z.coerce.number().positive('Total area must be a positive number'),
  specifications_bedrooms: z.coerce
    .number()
    .int()
    .min(0, 'Bedrooms must be a non-negative integer')
    .optional(),
  specifications_bathrooms: z.coerce
    .number()
    .min(0, 'Bathrooms must be a non-negative number')
    .optional(),
  specifications_floors: z.coerce.number().int().min(1, 'Floors must be at least 1').optional(),
  specifications_garageSpaces: z.coerce
    .number()
    .int()
    .min(0, 'Garage spaces must be a non-negative integer')
    .optional(),
  specifications_maxOccupants: z.coerce
    .number()
    .int()
    .min(1, 'Maximum occupants must be at least 1')
    .optional(),
  specifications_lotSize: z.coerce
    .number()
    .positive('Lot size must be a positive number')
    .optional(),

  // Fees
  fees_taxAmount: z.coerce.number().min(0).optional(),
  fees_rentalAmount: z.coerce.number().min(0).optional(),
  fees_managementFees: z.coerce.number().min(0).optional(),
  fees_currency: z.enum(['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'JPY']).optional().default('USD'),

  // Utilities - using boolean validation
  utilities_water: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(BaseCSVProcessorService.parseBoolean),
  utilities_gas: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(BaseCSVProcessorService.parseBoolean),
  utilities_electricity: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(BaseCSVProcessorService.parseBoolean),
  utilities_internet: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(BaseCSVProcessorService.parseBoolean),
  utilities_cabletv: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(BaseCSVProcessorService.parseBoolean),

  // Interior amenities
  interiorAmenities_airConditioning: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(BaseCSVProcessorService.parseBoolean),
  interiorAmenities_heating: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(BaseCSVProcessorService.parseBoolean),
  interiorAmenities_washerDryer: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(BaseCSVProcessorService.parseBoolean),
  interiorAmenities_dishwasher: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(BaseCSVProcessorService.parseBoolean),
  interiorAmenities_fridge: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(BaseCSVProcessorService.parseBoolean),
  interiorAmenities_furnished: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(BaseCSVProcessorService.parseBoolean),
  interiorAmenities_storageSpace: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(BaseCSVProcessorService.parseBoolean),

  // Community amenities
  communityAmenities_swimmingPool: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(BaseCSVProcessorService.parseBoolean),
  communityAmenities_fitnessCenter: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(BaseCSVProcessorService.parseBoolean),
  communityAmenities_elevator: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(BaseCSVProcessorService.parseBoolean),
  communityAmenities_parking: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(BaseCSVProcessorService.parseBoolean),
  communityAmenities_securitySystem: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(BaseCSVProcessorService.parseBoolean),
  communityAmenities_petFriendly: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(BaseCSVProcessorService.parseBoolean),

  communityAmenities_laundryFacility: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(BaseCSVProcessorService.parseBoolean),
  communityAmenities_doorman: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(BaseCSVProcessorService.parseBoolean),
});
