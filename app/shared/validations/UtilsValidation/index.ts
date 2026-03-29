import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import {
  NotificationDAO,
  PropertyUnitDAO,
  InvitationDAO,
  PropertyDAO,
  PaymentDAO,
  ClientDAO,
  VendorDAO,
  LeaseDAO,
  UserDAO,
} from '@dao/index';

export const getContainer = async () => {
  const { container } = await import('@di/setup');
  return container;
};

/**
 * Zod schema for a real calendar date that rejects impossible dates like Feb 30 or Jan 32.
 * z.coerce.date() silently overflows these (e.g. Feb 29 on a non-leap year → Mar 1),
 * so this validates the date components match after construction.
 *
 * Accepts ISO strings ("2027-03-15", "2027-03-15T10:00:00Z") and Date objects.
 */
export const calendarDate = (errorMessage?: string) =>
  z
    .union([z.string(), z.date()])
    .refine(
      (val): boolean => {
        if (val instanceof Date) return !isNaN(val.getTime());
        const d = new Date(val as string);
        if (isNaN(d.getTime())) return false;
        const dateOnly = (val as string).split('T')[0];
        const parts = dateOnly.split('-');
        if (parts.length !== 3) return false;
        const [year, month, day] = parts.map(Number);
        if (isNaN(year) || isNaN(month) || isNaN(day)) return false;
        return (
          d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && d.getUTCDate() === day
        );
      },
      { message: errorMessage ?? 'Invalid date: this day does not exist in the calendar' }
    )
    .transform((val) => (val instanceof Date ? val : new Date(val as string)));

export const ValidateCuidSchema = z.object({
  cuid: z.string().refine(
    async (cuid) => {
      const { clientDAO }: { clientDAO: ClientDAO } = (await getContainer()).cradle;
      const client = await clientDAO.findFirst({ cuid });
      return !!client;
    },
    {
      message: 'Invalid params detected in the request.',
    }
  ),
});

export const ValidateVuidSchema = z.object({
  vuid: z
    .string()
    .optional()
    .refine(
      async (vuid) => {
        const { vendorDAO }: { vendorDAO: VendorDAO } = (await getContainer()).cradle;
        const vendor = await vendorDAO.findFirst({ vuid });
        return !!vendor;
      },
      {
        message: 'Invalid params detected in the request.',
      }
    ),
});

export const ValidateNuidSchema = z.object({
  nuid: z.string().refine(
    async (nuid) => {
      const { notificationDAO }: { notificationDAO: NotificationDAO } = (await getContainer())
        .cradle;
      const notification = await notificationDAO.findFirst({ nuid });
      return !!notification;
    },
    {
      message: 'Invalid params detected in the request.',
    }
  ),
});

export const ValidateLuidSchema = z.object({
  luid: z.string().refine(
    async (luid) => {
      const { leaseDAO }: { leaseDAO: LeaseDAO } = (await getContainer()).cradle;
      const lease = await leaseDAO.findFirst({ luid });
      return !!lease;
    },
    {
      message: 'Invalid params detected in the request.',
    }
  ),
});

export const ValidatePropertyIdSchema = z.object({
  id: z.string().refine(
    async (id) => {
      const { propertyDAO }: { propertyDAO: PropertyDAO } = (await getContainer()).cradle;
      const property = await propertyDAO.findById(id);
      return !!property;
    },
    {
      message: 'Invalid params detected in the request.',
    }
  ),
});

export const ValidateEmailSchema = z.object({
  email: z
    .string()
    .email({
      message: 'Invalid email format',
    })
    .refine(
      async (email) => {
        const { userDAO }: { userDAO: UserDAO } = (await getContainer()).cradle;
        const user = await userDAO.findFirst({ email });
        return !!user;
      },
      {
        message: 'Email does not exist',
      }
    ),
});

const validatepuid = async (type: 'id' | 'puid', value: string) => {
  const { propertyUnitDAO }: { propertyUnitDAO: PropertyUnitDAO } = (await getContainer()).cradle;
  try {
    if (type === 'id' && isValidObjectId(value)) {
      const unit = await propertyUnitDAO.findFirst({ _id: value, deletedAt: null });
      return !!unit;
    }
    if (type === 'puid' && value.length) {
      const unit = await propertyUnitDAO.findFirst({ puid: value, deletedAt: null });
      return !!unit;
    }
    return false;
  } catch (error) {
    console.error('Error checking property existence', error);
    return false;
  }
};
export const ValidateUnitPuid = z.object({
  puid: z.string().refine(async (puid) => await validatepuid('puid', puid), {
    message: 'Invalid unit ID',
  }),
});

export const ValidateInvitationIuidSchema = z
  .object({
    iuid: z.string(),
    cuid: z.string(),
  })
  .superRefine(async (data, ctx) => {
    if (!data.iuid) {
      return;
    }

    const container = await getContainer();
    const { invitationDAO }: { invitationDAO: InvitationDAO } = container.cradle;
    const invitation = await invitationDAO.findByIuidUnsecured(data.iuid);

    if (!invitation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid invitation ID',
        path: ['iuid'],
      });
      return;
    }

    if (data.cuid) {
      const populatedClient = invitation.clientId as any;
      const clientCuid =
        populatedClient && typeof populatedClient === 'object' && 'cuid' in populatedClient
          ? populatedClient.cuid
          : null;

      if (!clientCuid || clientCuid !== data.cuid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invitation does not belong to this client',
          path: ['cuid'],
        });
      }
    }
  });

export const ValidateCuidAndLeaseIdSchema = z.object({
  cuid: z.string().refine(
    async (cuid) => {
      const { clientDAO }: { clientDAO: ClientDAO } = (await getContainer()).cradle;
      const client = await clientDAO.findFirst({ cuid });
      return !!client;
    },
    {
      message: 'Invalid params detected in the request.',
    }
  ),
  leaseId: z.string().min(1, 'Lease ID is required'),
});

export const ValidatePytUidSchema = z.object({
  pytuid: z.string().refine(
    async (pytuid) => {
      const { paymentDAO }: { paymentDAO: PaymentDAO } = (await getContainer()).cradle;
      const payment = await paymentDAO.findFirst({ pytuid });
      return !!payment;
    },
    {
      message: 'Invalid params detected in the request.',
    }
  ),
});

export const UtilsValidations = {
  cuid: ValidateCuidSchema,
  vuid: ValidateVuidSchema,
  luid: ValidateLuidSchema,
  nuid: ValidateNuidSchema,
  unitPuid: ValidateUnitPuid,
  pytuid: ValidatePytUidSchema,
  isUniqueEmail: ValidateEmailSchema,
  propertyId: ValidatePropertyIdSchema,
  invitationuid: ValidateInvitationIuidSchema,
  cuidAndLeaseId: ValidateCuidAndLeaseIdSchema,
};
