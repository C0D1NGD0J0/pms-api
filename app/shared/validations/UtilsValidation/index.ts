import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { PropertyUnitDAO, InvitationDAO, PropertyDAO, ClientDAO, UserDAO } from '@dao/index';

const getContainer = async () => {
  const { container } = await import('@di/setup');
  return container;
};

export const ValidatecuidSchema = z.object({
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

export const UtilsValidations = {
  cuid: ValidatecuidSchema,
  unitPuid: ValidateUnitPuid,
  isUniqueEmail: ValidateEmailSchema,
  propertyId: ValidatePropertyIdSchema,
  invitationuid: ValidateInvitationIuidSchema,
};
