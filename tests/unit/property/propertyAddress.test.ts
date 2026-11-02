import { InvalidRequestError } from '@shared/customErrors';
import { AUTO_VERIFIED_NOTE } from '@utils/propertyLeasing';
import { IUserRole } from '@shared/constants/roles.constants';
import { OwnershipType } from '@interfaces/property.interface';
import {
  resolveNewPropertyAddress,
  buildVerificationReset,
  ADDRESS_CHANGED_NOTE,
  buildAddressUpdate,
  isAddressMove,
} from '@services/property/propertyAddress';

const log = { warn: jest.fn() } as any;
const actorId = '6acd03c359d0cb2da82035db';

const geocodedParts = {
  street: 'Oak Ave',
  streetNumber: '40',
  city: 'Toronto',
  state: 'Ontario',
  postCode: 'M5V 2T6',
  country: 'Canada',
  fullAddress: '40 Oak Ave, Toronto, ON M5V 2T6, Canada',
  coordinates: [-79.39, 43.64],
};

const makeGeoCoder = (result: unknown) =>
  ({ parseLocation: jest.fn().mockResolvedValue(result) }) as any;

const makeDeps = (overrides: { duplicate?: boolean; geocode?: unknown } = {}) => ({
  propertyDAO: {
    findPropertyByAddress: jest
      .fn()
      .mockResolvedValue(overrides.duplicate ? { pid: 'other' } : null),
  } as any,
  geoCoderService: makeGeoCoder(overrides.geocode ?? { success: true, data: geocodedParts }),
  log,
});

const property = {
  pid: 'P1',
  address: {
    fullAddress: '12 Maple St, Toronto, ON',
    street: 'Maple St',
    streetNumber: '12',
    city: 'Toronto',
    state: 'Ontario',
    unitNumber: '3',
  },
  owner: { type: OwnershipType.EXTERNAL_OWNER },
} as any;

describe('isAddressMove', () => {
  it('ignores case and spacing', () => {
    expect(isAddressMove(property, { fullAddress: ' 12 maple st, toronto, on ' })).toBe(false);
  });

  it('is true for a different address', () => {
    expect(isAddressMove(property, { fullAddress: '40 Oak Ave, Toronto' })).toBe(true);
  });

  it('is false when no address was sent', () => {
    expect(isAddressMove(property, undefined)).toBe(false);
  });
});

describe('buildAddressUpdate', () => {
  const params = {
    cuid: 'C1',
    property,
    actorRole: IUserRole.MANAGER,
    actorId,
  };

  it('replaces the whole address on a move, so old parts do not survive', async () => {
    const deps = makeDeps();
    const update = await buildAddressUpdate(deps, {
      ...params,
      incoming: { fullAddress: '40 Oak Ave, Toronto, ON', streetNumber: '40' },
    });

    expect(update.$set!.address).toEqual({
      fullAddress: '40 Oak Ave, Toronto, ON',
      streetNumber: '40',
      street: 'Oak Ave',
      city: 'Toronto',
      state: 'Ontario',
      postCode: 'M5V 2T6',
      country: 'Canada',
    });
    expect(update.$set!.computedLocation).toEqual({
      type: 'Point',
      coordinates: [-79.39, 43.64],
    });
    expect(deps.propertyDAO.findPropertyByAddress).toHaveBeenCalledWith(
      '40 Oak Ave, Toronto, ON',
      'C1',
      undefined,
      'P1'
    );
  });

  it('rejects a move onto another property address', async () => {
    await expect(
      buildAddressUpdate(makeDeps({ duplicate: true }), {
        ...params,
        incoming: { fullAddress: '40 Oak Ave, Toronto, ON' },
      })
    ).rejects.toMatchObject({
      constructor: InvalidRequestError,
      errorInfo: { 'address.fullAddress': [expect.any(String)] },
    });
  });

  it('still saves when the geocoder is down, and drops the old location', async () => {
    const update = await buildAddressUpdate(
      makeDeps({ geocode: { success: false, data: null, reason: 'unavailable' } }),
      { ...params, incoming: { fullAddress: '40 Oak Ave, Toronto, ON', city: 'Toronto' } }
    );

    expect(update.$set!.address).toEqual({
      fullAddress: '40 Oak Ave, Toronto, ON',
      city: 'Toronto',
    });
    expect(update.$set).not.toHaveProperty('computedLocation');
    expect(update.$unset).toEqual(expect.objectContaining({ computedLocation: '' }));
  });

  it('survives a geocoder that throws', async () => {
    const deps = makeDeps();
    deps.geoCoderService.parseLocation.mockRejectedValue(new Error('boom'));

    await expect(
      buildAddressUpdate(deps, { ...params, incoming: { fullAddress: '40 Oak Ave' } })
    ).resolves.toBeDefined();
  });

  it('sends a moved property back for verification', async () => {
    const update = await buildAddressUpdate(makeDeps(), {
      ...params,
      incoming: { fullAddress: '40 Oak Ave, Toronto, ON' },
    });

    expect(update.$set!.verificationStatus).toBe('unverified');
    expect(update.$unset).toEqual(expect.objectContaining({ verificationGracePeriod: '' }));
    expect(update.$push!.verificationDetails).toMatchObject({
      action: 'reset',
      notes: ADDRESS_CHANGED_NOTE,
    });
  });

  it('re-sending the same address only replaces its parts', async () => {
    const deps = makeDeps();
    const update = await buildAddressUpdate(deps, {
      ...params,
      incoming: { fullAddress: '12 Maple St, Toronto, ON', unitNumber: '4' },
    });

    expect(update).toEqual({
      $set: {
        address: {
          fullAddress: '12 Maple St, Toronto, ON',
          street: 'Maple St',
          streetNumber: '12',
          city: 'Toronto',
          state: 'Ontario',
          unitNumber: '4',
        },
      },
    });
    expect(deps.geoCoderService.parseLocation).not.toHaveBeenCalled();
    expect(deps.propertyDAO.findPropertyByAddress).not.toHaveBeenCalled();
  });
});

describe('buildVerificationReset', () => {
  it('re-verifies a company-owned property moved by a manager', () => {
    const reset = buildVerificationReset(OwnershipType.COMPANY_OWNED, IUserRole.MANAGER, actorId);

    expect(reset.$set!.verificationStatus).toBe('verified');
    expect(reset.$push!.verificationDetails).toMatchObject({
      action: 'verified',
      notes: AUTO_VERIFIED_NOTE,
    });
  });

  it('needs a review when staff moved it, even if company-owned', () => {
    const reset = buildVerificationReset(OwnershipType.COMPANY_OWNED, IUserRole.STAFF, actorId);
    expect(reset.$set!.verificationStatus).toBe('unverified');
  });
});

describe('resolveNewPropertyAddress', () => {
  it('fills parts the form left out and adds the location', async () => {
    const result = await resolveNewPropertyAddress(
      makeGeoCoder({ success: true, data: geocodedParts }),
      { fullAddress: '40 Oak Ave, Toronto, ON', streetNumber: 40, unitNumber: ' ' },
      log
    );

    expect(result.address).toMatchObject({ streetNumber: '40', city: 'Toronto' });
    expect(result.address).not.toHaveProperty('unitNumber');
    expect(result.computedLocation).toEqual({ type: 'Point', coordinates: [-79.39, 43.64] });
  });

  it('skips a 0,0 point', async () => {
    const result = await resolveNewPropertyAddress(
      makeGeoCoder({ success: true, data: { ...geocodedParts, coordinates: [0, 0] } }),
      { fullAddress: '40 Oak Ave' },
      log
    );
    expect(result.computedLocation).toBeUndefined();
  });
});
