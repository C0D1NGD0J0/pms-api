import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { PropertyUnitDAO, PropertyDAO, ClientDAO, UserDAO } from '@dao/index';

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

export const UtilsValidations = {
  cuid: ValidatecuidSchema,
  unitPuid: ValidateUnitPuid,
  isUniqueEmail: ValidateEmailSchema,
  propertyId: ValidatePropertyIdSchema,
};
