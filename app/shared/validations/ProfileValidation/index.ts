import { z } from 'zod';

const employeeInfoSchema = z.object({
  jobTitle: z.string().min(2).max(100).optional(),
  department: z.string().min(2).max(50).optional(),
  reportsTo: z.string().min(2).max(100).optional(),
  employeeId: z.string().min(3).max(20).optional(),
  startDate: z.date().optional(),
  permissions: z.array(z.string()).optional(),
});

// Updated vendor info schema for profile references only
// Business data is now stored in the vendor collection
const vendorInfoSchema = z.object({
  vendorId: z
    .string()
    .length(24, 'Vendor ID must be a valid MongoDB ObjectId')
    .regex(/^[0-9a-fA-F]{24}$/, 'Vendor ID must contain only hexadecimal characters')
    .optional(),
  linkedVendorId: z
    .string()
    .length(24, 'Linked vendor ID must be a valid MongoDB ObjectId')
    .regex(/^[0-9a-fA-F]{24}$/, 'Linked vendor ID must contain only hexadecimal characters')
    .optional(),
  isLinkedAccount: z.boolean().default(false),
});

// Role-specific profile updates
export const ProfileValidations = {
  updateEmployeeInfo: employeeInfoSchema,
  // @deprecated Use VendorValidations for vendor business data updates
  // This now only validates vendor reference data in the profile
  updateVendorInfo: vendorInfoSchema,

  // Combined validation for profile creation/update
  profileUpdate: z
    .object({
      employeeInfo: employeeInfoSchema.optional(),
      // Vendor info now only contains references, not business data
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
