import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { PropertyDAO } from '@dao/index';
import { GeoCoderService } from '@services/external';
import { InvalidRequestError } from '@shared/customErrors';
import { IUserRole } from '@shared/constants/roles.constants';
import { shouldAutoVerifyOnCreate, AUTO_VERIFIED_NOTE } from '@utils/propertyLeasing';
import { VerificationStatusEnum, IPropertyDocument } from '@interfaces/property.interface';

type IncomingAddress = Partial<Record<keyof PropertyAddress, unknown>> & { fullAddress?: unknown };
type PropertyAddress = IPropertyDocument['address'];

const ADDRESS_PART_KEYS = [
  'street',
  'streetNumber',
  'city',
  'state',
  'postCode',
  'country',
] as const;

export const ADDRESS_CHANGED_NOTE = 'Address changed: ownership needs to be verified again';

export interface IMongoUpdateOperation {
  $push?: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $unset?: Record<string, ''>;
}

const normalize = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const textOrUndefined = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
};

/** True when the submitted address points somewhere else, not just a re-sent or edited part. */
export const isAddressMove = (
  property: Pick<IPropertyDocument, 'address'>,
  incoming?: IncomingAddress | null
): boolean =>
  !!textOrUndefined(incoming?.fullAddress) &&
  normalize(incoming?.fullAddress) !== normalize(property.address?.fullAddress);

export const assertAddressAvailable = async (
  propertyDAO: PropertyDAO,
  fullAddress: string,
  cuid: string,
  excludePid?: string
): Promise<void> => {
  const existing = await propertyDAO.findPropertyByAddress(
    fullAddress,
    cuid,
    undefined,
    excludePid
  );
  if (existing) {
    const message = t('property.errors.duplicateAddress');
    throw new InvalidRequestError({ message, errorInfo: { 'address.fullAddress': [message] } });
  }
};

/** Geocoding never blocks a save: a lookup failure only leaves the property without a location. */
const geocode = async (
  geoCoderService: GeoCoderService,
  fullAddress: string,
  log: Logger
): Promise<Record<string, unknown> | null> => {
  try {
    const result = await geoCoderService.parseLocation(fullAddress);
    if (result.success && result.data) return result.data;
    log.warn({ reason: result.reason }, 'Property address could not be geocoded');
  } catch (error) {
    log.warn({ error }, 'Property address geocoding failed');
  }
  return null;
};

const toPoint = (coordinates: unknown): { type: 'Point'; coordinates: [number, number] } | null => {
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return null;
  const [lng, lat] = coordinates.map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || (lng === 0 && lat === 0)) return null;
  return { type: 'Point', coordinates: [lng, lat] };
};

/**
 * The address exactly as it will be stored. The whole object is replaced, so no part of a
 * previous address survives a move; parts the submission leaves out are filled from `fallback`.
 */
const buildStoredAddress = (
  incoming: IncomingAddress,
  fallback: Record<string, unknown> | null | undefined
): PropertyAddress => {
  const address: Record<string, string> = { fullAddress: String(incoming.fullAddress).trim() };
  for (const key of ADDRESS_PART_KEYS) {
    const value = textOrUndefined(incoming[key]) ?? textOrUndefined(fallback?.[key]);
    if (value) address[key] = value;
  }
  const unitNumber = textOrUndefined(incoming.unitNumber);
  if (unitNumber) address.unitNumber = unitNumber;
  return address as unknown as PropertyAddress;
};

/** Leasing waits for a fresh ownership review, unless whoever moved it could verify it anyway. */
export const buildVerificationReset = (
  ownerType: string | undefined,
  actorRole: IUserRole,
  actorId: string
): IMongoUpdateOperation => {
  const autoVerified = shouldAutoVerifyOnCreate(ownerType, actorRole);
  return {
    $set: {
      verificationStatus: autoVerified
        ? VerificationStatusEnum.VERIFIED
        : VerificationStatusEnum.UNVERIFIED,
    },
    $unset: { verificationGracePeriod: '' },
    $push: {
      verificationDetails: {
        action: autoVerified ? 'verified' : 'reset',
        actor: new Types.ObjectId(actorId),
        timestamp: new Date(),
        notes: autoVerified ? AUTO_VERIFIED_NOTE : ADDRESS_CHANGED_NOTE,
      },
    },
  };
};

/**
 * Update operators for an address being saved. A move is checked for duplicates, geocoded
 * and sends the property back for ownership verification; re-sending the same address only
 * replaces its parts.
 */
export const buildAddressUpdate = async (
  deps: { propertyDAO: PropertyDAO; geoCoderService: GeoCoderService; log: Logger },
  params: {
    cuid: string;
    property: Pick<IPropertyDocument, 'pid' | 'address' | 'owner'>;
    incoming: IncomingAddress;
    ownerType?: string;
    actorRole: IUserRole;
    actorId: string;
  }
): Promise<IMongoUpdateOperation> => {
  const { cuid, property, incoming, actorRole, actorId } = params;

  if (!isAddressMove(property, incoming)) {
    return { $set: { address: buildStoredAddress(incoming, property.address as any) } };
  }

  const fullAddress = String(incoming.fullAddress).trim();
  await assertAddressAvailable(deps.propertyDAO, fullAddress, cuid, property.pid);

  const geocoded = await geocode(deps.geoCoderService, fullAddress, deps.log);
  const location = toPoint(geocoded?.coordinates);
  const reset = buildVerificationReset(
    params.ownerType ?? property.owner?.type,
    actorRole,
    actorId
  );

  return mergeUpdateOperations(
    {
      $set: {
        address: buildStoredAddress(incoming, geocoded),
        ...(location && { computedLocation: location }),
      },
      // The old point would place the property at its previous address
      ...(!location && { $unset: { computedLocation: '' } }),
    },
    reset
  );
};

/** Geocoded parts and location for a new property; never throws. */
export const resolveNewPropertyAddress = async (
  geoCoderService: GeoCoderService,
  incoming: IncomingAddress,
  log: Logger
): Promise<{
  address: PropertyAddress;
  computedLocation?: { type: 'Point'; coordinates: [number, number] };
}> => {
  const geocoded = await geocode(geoCoderService, String(incoming.fullAddress).trim(), log);
  const location = toPoint(geocoded?.coordinates);
  return {
    address: buildStoredAddress(incoming, geocoded),
    ...(location && { computedLocation: location }),
  };
};

export const mergeUpdateOperations = <T extends IMongoUpdateOperation>(
  target: T,
  addition: IMongoUpdateOperation
): T => {
  for (const operator of ['$set', '$unset', '$push'] as const) {
    if (!addition[operator]) continue;
    target[operator] = { ...(target[operator] ?? {}), ...addition[operator] } as any;
  }
  return target;
};
