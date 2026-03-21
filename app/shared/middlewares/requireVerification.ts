import { t } from '@shared/languages';
import { ClientDAO } from '@dao/clientDAO';
import { NextFunction, Response } from 'express';
import { ForbiddenError } from '@shared/customErrors';
import { AppRequest } from '@interfaces/utils.interface';

/**
 * Blocks key actions when a client is past its 3-day verification deadline
 * and has not yet been verified by the platform admin.
 * Apply to: POST /properties, POST /invitations/:cuid/send, etc.
 */
export const requireVerification = async (
  req: AppRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const cuid = req.context?.currentuser?.client?.cuid;
    if (!cuid) return next();

    const clientDAO = req.container.resolve<ClientDAO>('clientDAO');
    const client = await clientDAO.getClientByCuid(cuid);
    if (!client) return next();

    if (
      !client.isVerified &&
      client.verificationDeadline &&
      new Date() > client.verificationDeadline
    ) {
      return next(new ForbiddenError({ message: t('client.errors.verificationRequired') }));
    }

    next();
  } catch (error) {
    next(error);
  }
};
