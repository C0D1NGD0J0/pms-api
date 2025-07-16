import { z } from 'zod';

const employeeInfoSchema = z.object({
  jobTitle: z.string().min(2).max(100).optional(),
  department: z.string().min(2).max(50).optional(),
  reportsTo: z.string().min(2).max(100).optional(),
  employeeId: z.string().min(3).max(20).optional(),
  startDate: z.date().optional(),
  permissions: z.array(z.string()).optional(),
});

const vendorInfoSchema = z.object({
  address: z
    .object({
      city: z.string().min(1).max(100).optional(),
      computedLocation: z.object({
        coordinates: z
          .array(z.number())
          .length(2)
          .refine(
            (coords) =>
              coords[0] >= -180 && coords[0] <= 180 && coords[1] >= -90 && coords[1] <= 90,
            {
              message: 'Coordinates must be [longitude, latitude] with valid ranges',
            }
          ),
        type: z.literal('Point'),
      }),
      country: z.string().min(1).max(100).optional(),
      fullAddress: z.string().min(1).max(255),
      postCode: z.string().min(1).max(20).optional(),
      state: z.string().min(1).max(100).optional(),
      street: z.string().min(1).max(255).optional(),
      streetNumber: z.string().min(1).max(20).optional(),
      unitNumber: z.string().min(1).max(20).optional(),
    })
    .optional(),
  companyName: z.string().min(2).max(100).optional(),
  businessType: z.string().min(2).max(50).optional(),
  registrationNumber: z.string().min(3).max(50).optional(),
  taxId: z.string().min(5).max(20).optional(),
  yearsInBusiness: z.number().min(0).max(100).optional(),
  contactPerson: z
    .object({
      name: z.string().min(2).max(100),
      jobTitle: z.string().min(2).max(100),
      department: z.string().min(2).max(50).optional(),
      email: z.string().email().optional(),
      phone: z.string().min(10).max(20).optional(),
    })
    .optional(),
  servicesOffered: z
    .object({
      plumbing: z.boolean().optional(),
      electrical: z.boolean().optional(),
      hvac: z.boolean().optional(),
      cleaning: z.boolean().optional(),
      landscaping: z.boolean().optional(),
      painting: z.boolean().optional(),
      carpentry: z.boolean().optional(),
      roofing: z.boolean().optional(),
      security: z.boolean().optional(),
      pestControl: z.boolean().optional(),
      applianceRepair: z.boolean().optional(),
      maintenance: z.boolean().optional(),
      other: z.boolean().optional(),
    })
    .optional(),
  serviceAreas: z
    .object({
      maxDistance: z.number().refine((value) => [10, 15, 25, 50].includes(value), {
        message: 'Max distance must be one of: 10, 15, 25, or 50 km',
      }),
      baseLocation: z
        .object({
          address: z.string().min(1).max(255),
          coordinates: z
            .array(z.number())
            .length(2)
            .refine(
              (coords) =>
                coords[0] >= -180 && coords[0] <= 180 && coords[1] >= -90 && coords[1] <= 90,
              {
                message: 'Coordinates must be [longitude, latitude] with valid ranges',
              }
            ),
        })
        .optional(),
    })
    .optional(),
  insuranceInfo: z
    .object({
      provider: z.string().min(2).max(100).optional(),
      policyNumber: z.string().min(5).max(50).optional(),
      expirationDate: z.date().optional(),
      coverageAmount: z.number().min(0).optional(),
    })
    .optional(),
});

// Role-specific profile updates
export const ProfileValidations = {
  updateEmployeeInfo: employeeInfoSchema,
  updateVendorInfo: vendorInfoSchema,

  // Combined validation for profile creation/update
  profileUpdate: z
    .object({
      employeeInfo: employeeInfoSchema.optional(),
      vendorInfo: vendorInfoSchema.optional(),
    })
    .refine(
      (data) => {
        // Ensure only one role-specific info is provided
        const hasEmployee = data.employeeInfo && Object.keys(data.employeeInfo).length > 0;
        const hasVendor = data.vendorInfo && Object.keys(data.vendorInfo).length > 0;
        return !hasEmployee || !hasVendor;
      },
      {
        message: 'Cannot have both employee and vendor information',
      }
    ),
};
