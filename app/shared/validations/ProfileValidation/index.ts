import { z } from 'zod';

// Employee info validation
const employeeInfoSchema = z.object({
  jobTitle: z.string().min(2).max(100).optional(),
  department: z.string().min(2).max(50).optional(),
  reportsTo: z.string().min(2).max(100).optional(),
  employeeId: z.string().min(3).max(20).optional(),
  startDate: z.date().optional(),
  permissions: z.array(z.string()).optional(),
});

// Vendor info validation
const vendorInfoSchema = z.object({
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
      downtown: z.boolean().optional(),
      uptown: z.boolean().optional(),
      suburbs: z.boolean().optional(),
      industrial: z.boolean().optional(),
      commercial: z.boolean().optional(),
      residential: z.boolean().optional(),
      citywide: z.boolean().optional(),
      regional: z.boolean().optional(),
      statewide: z.boolean().optional(),
      national: z.boolean().optional(),
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
