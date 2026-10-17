import { LeaseDAO } from '@dao/index';
import { MoneyUtils } from '@utils/money.utils';
import { ICurrentUser } from '@interfaces/user.interface';
import { ValidationRequestError } from '@shared/customErrors';
import { IPropertyUnitDocument, IPropertyUnit } from '@interfaces/propertyUnit.interface';
import { IMMUTABLE_UNIT_FIELDS_WITH_LEASE_HISTORY, createSafeMongoUpdate } from '@utils/index';

import { shouldShowPendingChanges, generateChangesSummary } from './propertyHelpers';

/**
 * Throws if any update fields are structurally immutable due to non-draft lease history.
 * Applies to ALL roles — no admin bypass — because these fields appear on legal lease documents.
 *
 * Uses unit.currentLease as a zero-DB fast path; only falls back to a DAO query
 * when the unit has no currently active lease reference but may have historical ones.
 */
export const validateUnitLeaseImmutableFields = async (
  unit: IPropertyUnitDocument,
  cuid: string,
  updateData: Partial<IPropertyUnit>,
  leaseDAO: LeaseDAO
): Promise<void> => {
  // Edit forms resend the whole unit, so only a changed value counts as an attempt
  const lockedFieldsAttempted = Object.keys(updateData).filter(
    (f) =>
      (IMMUTABLE_UNIT_FIELDS_WITH_LEASE_HISTORY as readonly string[]).includes(f) &&
      String((updateData as any)[f]) !== String((unit as any)[f])
  );

  if (lockedFieldsAttempted.length === 0) return;

  // Fast path: currentLease pointer is set — no DB query needed
  const hasActiveLease = !!unit.currentLease;
  const hasLeaseHistory =
    hasActiveLease || (await leaseDAO.hasNonDraftLeaseForUnit(unit._id.toString(), cuid));

  if (hasLeaseHistory) {
    throw new ValidationRequestError({
      message: 'Cannot modify structural fields on a unit with active or historical leases',
      errorInfo: {
        fields: lockedFieldsAttempted.map(
          (f) => `'${f}' is locked — this unit has or has had a non-draft lease`
        ),
      },
    });
  }
};

/**
 * Preview of a unit's pending high-impact changes, in the same shape as a property's
 * pendingChangesPreview. Changed fields are dot-notation paths ("fees.rentAmount") so the UI can
 * show each one next to its current value. Staff only see their own pending changes.
 */
export const generateUnitPendingChangesPreview = (
  unit: Pick<IPropertyUnit, 'pendingChanges'>,
  currentUser: ICurrentUser
) => {
  if (!unit.pendingChanges || !shouldShowPendingChanges(currentUser, unit)) {
    return undefined;
  }

  const { updatedBy, updatedAt, displayName, ...requestedChanges } = unit.pendingChanges;
  // Shown in dollars, the way the property preview does
  const changes = createSafeMongoUpdate({
    ...requestedChanges,
    ...(requestedChanges.fees && { fees: MoneyUtils.formatMoneyDisplay(requestedChanges.fees) }),
  });
  const updatedFields = Object.keys(changes);

  return {
    updatedFields,
    updatedAt,
    updatedBy,
    displayName,
    summary: generateChangesSummary(updatedFields),
    changes,
  };
};
