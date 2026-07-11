import Logger from 'bunyan';
import { Response } from 'express';
import { createLogger } from '@utils/index';
import { httpStatusCodes } from '@utils/constants';
import { ForbiddenError } from '@shared/customErrors';
import { AppRequest } from '@interfaces/utils.interface';
import { ROLES } from '@shared/constants/roles.constants';
import { DSARService } from '@services/dsar/dsar.service';

export class DSARController {
  private readonly log: Logger;
  private readonly dsarService: DSARService;

  constructor({ dsarService }: { dsarService: DSARService }) {
    this.log = createLogger('DSARController');
    this.dsarService = dsarService;
  }

  exportUserData = async (req: AppRequest, res: Response): Promise<void> => {
    const { uid, cuid } = req.params;
    const currentUser = req.context.currentuser;
    const isSelf = currentUser?.uid === uid;
    const userRole = currentUser?.client?.role;
    const isAdmin = userRole === ROLES.SUPER_ADMIN || userRole === ROLES.ADMIN;

    if (!isSelf && !isAdmin) {
      throw new ForbiddenError({ message: 'Access denied' });
    }

    const data = await this.dsarService.exportUserData(uid, cuid);

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="dsar-export-${uid}-${Date.now()}.json"`
    );
    res.status(httpStatusCodes.OK).json(data);
  };

  anonymiseUser = async (req: AppRequest, res: Response): Promise<void> => {
    const { uid, cuid } = req.params;
    const currentUser = req.context.currentuser;
    const isSelf = currentUser?.uid === uid;
    const userRole = currentUser?.client?.role;
    const isAdmin = userRole === ROLES.SUPER_ADMIN || userRole === ROLES.ADMIN;

    if (!isSelf && !isAdmin) {
      throw new ForbiddenError({ message: 'Access denied' });
    }

    await this.dsarService.anonymiseUser(uid, cuid, currentUser?.uid ?? uid);
    res.status(httpStatusCodes.OK).json({ success: true, message: 'Account data anonymised' });
  };
}
