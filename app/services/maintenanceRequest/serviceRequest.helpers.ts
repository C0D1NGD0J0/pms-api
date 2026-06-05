import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { VendorDAO } from '@dao/vendorDAO';
import { CurrentUser } from '@utils/currentUserRole';
import { ICurrentUser } from '@interfaces/user.interface';
import { MaintenanceRequestDAO } from '@dao/maintenanceRequestDAO';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import {
  IMaintenanceRequestDocument,
  MaintenanceRequestStatus,
} from '@interfaces/maintenanceRequest.interface';

export const ALLOWED_TRANSITIONS: Record<MaintenanceRequestStatus, MaintenanceRequestStatus[]> = {
  [MaintenanceRequestStatus.PENDING]: [MaintenanceRequestStatus.OPEN],
  [MaintenanceRequestStatus.OPEN]: [
    MaintenanceRequestStatus.ASSIGNED,
    MaintenanceRequestStatus.CANCELLED,
  ],
  [MaintenanceRequestStatus.ASSIGNED]: [
    MaintenanceRequestStatus.IN_PROGRESS,
    MaintenanceRequestStatus.OPEN,
    MaintenanceRequestStatus.CANCELLED,
  ],
  [MaintenanceRequestStatus.IN_PROGRESS]: [
    MaintenanceRequestStatus.AWAITING_INVOICE,
    MaintenanceRequestStatus.CANCELLED,
  ],
  [MaintenanceRequestStatus.AWAITING_INVOICE]: [
    MaintenanceRequestStatus.COMPLETED,
    MaintenanceRequestStatus.CANCELLED,
  ],
  [MaintenanceRequestStatus.COMPLETED]: [],
  [MaintenanceRequestStatus.CANCELLED]: [],
};

/**
 * Resolves the primary vendor User._id for a team member.
 *
 * linkedVendorUid is stored in two formats depending on the invitation path:
 *   - Single invitation: primary vendor User._id as 24-hex ObjectId string
 *     (invitation.linkedVendorUid stored via `new Types.ObjectId(userId)` → `.toString()`)
 *   - Bulk CSV invitation: vendor entity vuid (e.g. "GNTM8EMXMA2Z")
 *
 * For the 24-hex case we always verify against the Vendor entity rather than
 * trusting the stored value blindly — a vuid coerced through ObjectId().toString()
 * also produces a 24-hex string that looks valid but is not a real User._id.
 *
 * Falls back to currentuser.vendorInfo.linkedVendorUid if client.linkedVendorUid is absent.
 */
export async function resolvePrimaryVendorId(
  vendorDAO: VendorDAO,
  currentuser: ICurrentUser
): Promise<Types.ObjectId | null> {
  const cuid = currentuser.client.cuid;
  const linkedVendorUid = currentuser.client.linkedVendorUid;
  if (!linkedVendorUid) return null;

  const vendor = await vendorDAO.getVendorByVuid(linkedVendorUid);
  if (!vendor) {
    return null; // No vendor found with the linkedVendorUid, return null
  }

  const connection = (vendor.connectedClients ?? []).find((c: any) => c.cuid === cuid);
  if (!connection?.primaryAccountHolderUserId) return null;

  return connection.primaryAccountHolderUserId;
}

/**
 * Verifies that the current user is the assigned vendor (or a team member
 * whose primary vendor account is the assigned vendor). Throws ForbiddenError
 * when the check fails.
 */
export async function assertVendorAuthorized(
  vendorDAO: VendorDAO,
  currentuser: ICurrentUser,
  request: { vendorId?: any },
  errorMessage?: string
): Promise<void> {
  const isAssigned = request.vendorId?.toString() === currentuser.sub;
  if (isAssigned) return;

  if (CurrentUser.isVendorTeamMember(currentuser)) {
    const primaryId = await resolvePrimaryVendorId(vendorDAO, currentuser);
    if (primaryId && request.vendorId?.toString() === primaryId.toString()) return;
  }

  throw new ForbiddenError({ message: errorMessage || t('maintenance.errors.notYourAssignment') });
}

export async function getRequestOrThrow(
  dao: MaintenanceRequestDAO,
  mruid: string,
  cuid: string
): Promise<IMaintenanceRequestDocument> {
  const request = await dao.getByMruid(mruid, cuid);
  if (!request) throw new NotFoundError({ message: t('maintenance.errors.notFound') });
  return request;
}

export function assertTransition(
  current: MaintenanceRequestStatus,
  next: MaintenanceRequestStatus
): void {
  if (!ALLOWED_TRANSITIONS[current].includes(next)) {
    throw new BadRequestError({
      message: t('maintenance.errors.invalidTransition', { current, next }),
    });
  }
}
