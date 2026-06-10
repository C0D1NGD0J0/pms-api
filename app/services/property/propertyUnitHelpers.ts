import { LeaseDAO } from '@dao/index';
import { ValidationRequestError } from '@shared/customErrors';
import { IMMUTABLE_UNIT_FIELDS_WITH_LEASE_HISTORY } from '@utils/index';
import { IPropertyUnitDocument, IPropertyUnit } from '@interfaces/propertyUnit.interface';

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
  const lockedFieldsAttempted = Object.keys(updateData).filter((f) =>
    (IMMUTABLE_UNIT_FIELDS_WITH_LEASE_HISTORY as readonly string[]).includes(f)
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
