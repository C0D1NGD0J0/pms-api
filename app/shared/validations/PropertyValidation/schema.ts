import { z } from 'zod';
import { container } from '@di/setup';
import { PropertyDAO, ClientDAO } from '@dao/index';
import { BaseCSVProcessorService } from '@services/csv/base';

const isUniqueAddress = async (address: string, clientId: string) => {
  const { propertyDAO }: { propertyDAO: PropertyDAO; clientDAO: ClientDAO } = container.cradle;
  try {
    const existingProperty = await propertyDAO.findFirst({
      'address.formattedAddress': address,
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

const FeesSchema = z.object({
  currency: z.enum(['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'JPY']).default('USD'),
  taxAmount: z.number().min(0, 'Tax amount must be a non-negative number').default(0),
  rentalAmount: z.number().min(0, 'Rental amount must be a non-negative number').default(0),
  managementFees: z.number().min(0, 'Management fees must be a non-negative number').default(0),
  securityDeposit: z.number().min(0, 'Security deposit must be a non-negative number').default(0),
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

const PropertyMediaDocumentSchema = z.object({
  documentType: z.enum(['deed', 'tax', 'insurance', 'inspection', 'other', 'lease']).optional(),
  url: z.string().url('Invalid URL format for document'),
  key: z.string().optional(),
  status: z.enum(['active', 'inactive']).default('active'),
  externalUrl: z.string().url('Invalid external URL format').optional(),
  uploadedAt: z.coerce
    .date({
      errorMap: (issue, { defaultError }) => ({
        message:
          issue.code === z.ZodIssueCode.invalid_date
            ? 'Invalid date format for uploaded date'
            : defaultError,
      }),
    })
    .default(() => new Date()),
  uploadedBy: z.string(),
  description: z.string().max(150, 'Description must be at most 150 characters').optional(),
  documentName: z.string().max(100, 'Document name must be at most 100 characters').optional(),
});

const DescriptionSchema = z.object({
  text: z.string().max(2000, 'Description text must be at most 2000 characters'),
  html: z.string().max(2000, 'Description HTML must be at most 2000 characters').optional(),
});

const CreatePropertySchema = z.object({
  name: z
    .string()
    .min(3, 'Property name must be at least 3 characters')
    .max(100, 'Property name must be at most 100 characters'),
  propertyType: PropertyTypeEnum,
  status: PropertyStatusEnum.default('available'),
  managedBy: z.string(),
  yearBuilt: z
    .number()
    .int()
    .min(1800, 'Year built must be at least 1800')
    .max(
      new Date().getFullYear() + 10,
      `Year built must be at most ${new Date().getFullYear() + 10}`
    )
    .optional(),
  fullAddress: z.string().min(5, 'Address must be at least 5 characters'),
  description: DescriptionSchema,
  cid: z.string(),
  occupancyStatus: OccupancyStatusEnum.default('vacant'),
  totalUnits: z.number().int().min(0).max(250).default(0),
  specifications: SpecificationsSchema,
  financialDetails: FinancialDetailsSchema.optional(),
  fees: FeesSchema,
  address: z.object({
    formattedAddress: z.string().min(5, 'Formatted address must be at least 5 characters'),
    street: z.string().optional(),
    streetNumber: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postCode: z.string().optional(),
    country: z.string().optional(),
  }),
  utilities: UtilitiesSchema.optional(),
  interiorAmenities: InteriorAmenitiesSchema.optional(),
  communityAmenities: CommunityAmenitiesSchema.optional(),
  documents: z.array(PropertyMediaDocumentSchema).optional(),
});

export const CreatePropertySchemaWithValidation = CreatePropertySchema.superRefine(
  async (data, ctx) => {
    if (data.fullAddress && data.cid) {
      const isUnique = await isUniqueAddress(data.fullAddress, data.cid);
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
  pid: z.string().refine(
    async (pid) => {
      const { propertyDAO }: { propertyDAO: PropertyDAO } = container.cradle;
      const property = await propertyDAO.findFirst({ pid });
      return !!property;
    },
    {
      message: 'Property not found',
    }
  ),
  occupancyStatus: OccupancyStatusEnum,
  totalUnits: z.number().min(0).max(500),
});

const PropertyClientRelationship = z.object({
  cid: z.string().trim().min(10, 'Client ID is required'),
  pid: z.string().trim().min(10, 'Property ID is required'),
});

export const PropertyClientRelationshipSchema = PropertyClientRelationship.superRefine(
  async (data, ctx) => {
    const { propertyDAO }: { propertyDAO: PropertyDAO } = container.cradle;
    const property = await propertyDAO.findFirst({
      pid: data.pid,
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
  fullAddress: z.string().min(5, 'Address must be at least 5 characters'),
  propertyType: PropertyTypeEnum,
  status: PropertyStatusEnum.optional().default('available'),
  occupancyStatus: OccupancyStatusEnum.optional().default('vacant'),
  totalUnits: z.coerce.number().min(0).max(500).optional(),
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
  fees_securityDeposit: z.coerce.number().min(0).optional(),
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
