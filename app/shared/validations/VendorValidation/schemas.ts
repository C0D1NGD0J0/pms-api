import { z } from 'zod';

// Address validation schema
const addressSchema = z.object({
  fullAddress: z.string().min(1, 'Full address is required').max(500),
  street: z.string().max(200).optional(),
  city: z.string().min(1, 'City is required').max(100),
  state: z.string().min(1, 'State is required').max(100),
  country: z.string().min(1, 'Country is required').max(100),
  postCode: z.string().min(1, 'Postal code is required').max(20),
  computedLocation: z
    .object({
      type: z.literal('Point'),
      coordinates: z.array(z.number()).length(2),
    })
    .optional(),
});

// Contact person validation schema
const contactPersonSchema = z.object({
  name: z.string().min(1, 'Contact person name is required').max(100),
  jobTitle: z.string().min(1, 'Job title is required').max(100),
  email: z.string().email('Invalid email format').max(255),
  phone: z.string().min(10, 'Phone number must be at least 10 digits').max(20),
});

// Services offered validation schema
const servicesOfferedSchema = z
  .object({
    plumbing: z.boolean().default(false),
    electrical: z.boolean().default(false),
    hvac: z.boolean().default(false),
    carpentry: z.boolean().default(false),
    painting: z.boolean().default(false),
    landscaping: z.boolean().default(false),
    cleaning: z.boolean().default(false),
    roofing: z.boolean().default(false),
    flooring: z.boolean().default(false),
    appliances: z.boolean().default(false),
    pest_control: z.boolean().default(false),
    security: z.boolean().default(false),
    general_maintenance: z.boolean().default(false),
  })
  .optional();

// Service areas validation schema
const serviceAreasSchema = z
  .object({
    baseLocation: z.string().min(1, 'Base location is required').max(200),
    maxDistance: z.number().min(1, 'Max distance must be at least 1 mile').max(500),
  })
  .optional();

// Insurance information validation schema
const insuranceInfoSchema = z
  .object({
    provider: z.string().max(200).optional(),
    policyNumber: z.string().max(50).optional(),
    expirationDate: z.string().datetime().optional().nullable(),
    coverageAmount: z.number().min(0).optional(),
  })
  .optional();

// Vendor stats validation schema
const vendorStatsSchema = z
  .object({
    completedJobs: z.number().min(0).default(0),
    activeJobs: z.number().min(0).default(0),
    rating: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, 'Rating must be a valid number')
      .default('0'),
    responseTime: z.string().max(20).default('24h'),
    onTimeRate: z
      .string()
      .regex(/^\d+(\.\d{1,2})?%$/, 'On-time rate must be a percentage')
      .default('0%'),
  })
  .optional();

// Business types enum
const businessTypesEnum = z.enum(
  [
    'general_contractor',
    'plumbing',
    'electrical',
    'hvac',
    'landscaping',
    'cleaning_services',
    'security_services',
    'professional_services',
    'maintenance_services',
    'specialty_contractor',
    'property_management',
    'other',
  ],
  {
    errorMap: () => ({ message: 'Please select a valid business type' }),
  }
);

// Create vendor schema
export const createVendorSchema = z.object({
  companyName: z.string().min(1, 'Company name is required').max(200),
  businessType: businessTypesEnum.default('professional_services'),
  yearsInBusiness: z.number().min(0, 'Years in business cannot be negative').max(100).default(0),
  registrationNumber: z.string().max(50).optional(),
  taxId: z.string().max(50).optional(),
  address: addressSchema.optional(),
  contactPerson: contactPersonSchema.optional(),
  servicesOffered: servicesOfferedSchema,
  serviceAreas: serviceAreasSchema,
  insuranceInfo: insuranceInfoSchema,
  stats: vendorStatsSchema,
  averageServiceCost: z.number().min(0).default(0),
  reviewCount: z.number().min(0).default(0),
});

// Update vendor schema (all fields optional except primaryAccountHolder validation)
export const updateVendorSchema = z.object({
  companyName: z.string().min(1, 'Company name cannot be empty').max(200).optional(),
  businessType: businessTypesEnum.optional(),
  yearsInBusiness: z.number().min(0, 'Years in business cannot be negative').max(100).optional(),
  registrationNumber: z.string().max(50).optional(),
  taxId: z.string().max(50).optional(),
  address: addressSchema.optional(),
  contactPerson: contactPersonSchema.optional(),
  servicesOffered: servicesOfferedSchema,
  serviceAreas: serviceAreasSchema,
  insuranceInfo: insuranceInfoSchema,
  stats: vendorStatsSchema,
  averageServiceCost: z.number().min(0).optional(),
  reviewCount: z.number().min(0).optional(),
});

// Vendor query parameters schema
export const vendorQuerySchema = z.object({
  businessType: businessTypesEnum.optional(),
  serviceType: z.string().max(100).optional(),
  location: z.string().max(200).optional(),
  maxDistance: z.number().min(1).max(500).optional(),
  rating: z.number().min(0).max(5).optional(),
  verified: z.boolean().optional(),
  limit: z.number().min(1).max(100).default(20),
  skip: z.number().min(0).default(0),
});

// Vendor ID parameter validation
export const vendorIdParamSchema = z.object({
  vendorId: z
    .string()
    .length(24, 'Vendor ID must be a valid MongoDB ObjectId')
    .regex(/^[0-9a-fA-F]{24}$/, 'Vendor ID must contain only hexadecimal characters'),
});

// Client vendors query schema
export const clientVendorsQuerySchema = z.object({
  cuid: z.string().min(8, 'Client ID must be at least 8 characters'),
  businessType: businessTypesEnum.optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  limit: z.number().min(1).max(100).default(20),
  skip: z.number().min(0).default(0),
});
