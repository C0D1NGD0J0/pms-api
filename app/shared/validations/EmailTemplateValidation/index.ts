import { z } from 'zod';

export const EmailTemplateValidations = {
  templateType: z.object({
    templateType: z.enum(['invitation-staff', 'invitation-vendor', 'invitation-tenant'], {
      message: 'Invalid invitation type provided.',
    }),
  }),

  renderTemplate: z.object({
    // Required variables
    companyName: z.string().min(1, 'Company name is required'),
    inviteeName: z.string().min(1, 'Invitee name is required'),
    inviterName: z.string().min(1, 'Inviter name is required'),
    role: z.string().min(1, 'Role is required'),
    expiresAt: z.string().datetime('Invalid expiration date'),
    inviteeEmail: z.string().email('Invalid email address'),

    // Optional variables
    customMessage: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    department: z.string().optional(),
    jobTitle: z.string().optional(),
    employeeId: z.string().optional(),
    reportsTo: z.string().optional(),
    startDate: z.string().optional(),
    expectedStartDate: z.string().optional(),
    phoneNumber: z.string().optional(),

    // Vendor specific variables
    businessType: z.string().optional(),
    serviceArea: z.string().optional(),
    contactPersonName: z.string().optional(),
    contactPersonEmail: z.string().email().optional(),
    contactPersonPhone: z.string().optional(),
    taxId: z.string().optional(),
    yearsInBusiness: z.string().optional(),
  }),
};
