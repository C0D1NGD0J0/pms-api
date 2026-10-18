import { Types } from 'mongoose';

const mockPropertyDAO = { findFirst: jest.fn() };
const mockPropertyUnitDAO = { findFirst: jest.fn() };

jest.mock('@di/setup', () => ({
  container: { cradle: { propertyDAO: mockPropertyDAO, propertyUnitDAO: mockPropertyUnitDAO } },
}));

import { PropertyUnitValidations } from '@shared/validations/PropertyUnitValidation';

const PROPERTY_ID = new Types.ObjectId().toString();

const uiUnit = (overrides: Record<string, unknown> = {}) => ({
  unitNumber: '101',
  unitType: 'residential',
  status: 'available',
  floor: 1,
  isActive: true,
  managedBy: new Types.ObjectId().toString(),
  specifications: { totalArea: 450, bedrooms: 3, bathrooms: 2, maxOccupants: 5 },
  amenities: { airConditioning: false, washerDryer: true, dishwasher: true, parking: false },
  utilities: { gas: false, trash: false, water: true, heating: true, centralAC: false },
  fees: { rentAmount: 1800, securityDeposit: 0, currency: 'USD' },
  description: '',
  ...overrides,
});

describe('PropertyUnitValidations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPropertyDAO.findFirst.mockReturnValue(Promise.resolve({ id: PROPERTY_ID }));
    // no existing unit with the same number
    mockPropertyUnitDAO.findFirst.mockReturnValue(Promise.resolve(null));
  });

  describe('createUnits', () => {
    it('keeps units[].managedBy sent by the unit form', async () => {
      const unit = uiUnit();
      const parsed = await PropertyUnitValidations.createUnits.parseAsync({
        units: [unit],
        cuid: 'CUID1',
        pid: 'PID1',
      });

      expect(parsed.units[0].managedBy).toBe(unit.managedBy);
    });

    it('accepts a unit without managedBy (the service assigns a default)', async () => {
      const { managedBy: _omit, ...unit } = uiUnit();
      const parsed = await PropertyUnitValidations.createUnits.parseAsync({
        units: [unit],
        cuid: 'CUID1',
        pid: 'PID1',
      });

      expect(parsed.units[0].managedBy).toBeUndefined();
    });

    it('rejects a managedBy that is not an ObjectId', async () => {
      await expect(
        PropertyUnitValidations.createUnits.parseAsync({
          units: [uiUnit({ managedBy: 'not-an-id' })],
          cuid: 'CUID1',
          pid: 'PID1',
        })
      ).rejects.toThrow('Must be a valid ID');
    });

    it('strips server-owned fields such as currentLease, createdBy and propertyId', async () => {
      const parsed = await PropertyUnitValidations.createUnits.parseAsync({
        units: [
          uiUnit({
            currentLease: new Types.ObjectId().toString(),
            createdBy: new Types.ObjectId().toString(),
            propertyId: new Types.ObjectId().toString(),
          }),
        ],
        cuid: 'CUID1',
        pid: 'PID1',
      });

      expect(parsed.units[0]).not.toHaveProperty('currentLease');
      expect(parsed.units[0]).not.toHaveProperty('createdBy');
      expect(parsed.units[0]).not.toHaveProperty('propertyId');
    });
  });

  describe('updateUnit', () => {
    it('accepts the full unit the edit form sends and keeps only client-editable fields', async () => {
      const unit = uiUnit();
      const parsed = await PropertyUnitValidations.updateUnit.parseAsync({
        ...unit,
        id: new Types.ObjectId().toString(),
        propertyId: new Types.ObjectId().toString(),
        puid: 'PUID-123',
        cuid: 'CUID1',
        createdBy: new Types.ObjectId().toString(),
        currentLease: new Types.ObjectId().toString(),
        deletedAt: null,
      });

      expect(parsed).toEqual({
        unitNumber: '101',
        unitType: 'residential',
        status: 'available',
        floor: 1,
        isActive: true,
        managedBy: unit.managedBy,
        description: '',
        fees: { rentAmount: 1800, securityDeposit: 0, currency: 'USD' },
        specifications: { totalArea: 450, bedrooms: 3, bathrooms: 2, maxOccupants: 5 },
        amenities: expect.objectContaining({ washerDryer: true, dishwasher: true }),
        utilities: { gas: false, trash: false, water: true, heating: true, centralAC: false },
      });
    });

    it('accepts a partial update without filling unrelated defaults', async () => {
      const parsed = await PropertyUnitValidations.updateUnit.parseAsync({
        fees: { rentAmount: 2000 },
      });

      expect(parsed).toEqual({ fees: { rentAmount: 2000 } });
    });

    it('rejects an unknown currency, unit type or a non-ObjectId managedBy', async () => {
      for (const body of [
        { fees: { currency: 'XYZ' } },
        { unitType: 'castle' },
        { managedBy: 'not-an-id' },
      ]) {
        await expect(PropertyUnitValidations.updateUnit.parseAsync(body)).rejects.toThrow();
      }
    });

    it('rejects a negative rent amount', async () => {
      await expect(
        PropertyUnitValidations.updateUnit.parseAsync({ fees: { rentAmount: -1 } })
      ).rejects.toThrow();
    });
  });

  describe('floor range (basements down to -4, 0 = ground)', () => {
    it.each([-4, -1, 0, 100])('accepts floor %i on create and update', async (floor) => {
      const created = await PropertyUnitValidations.createUnits.parseAsync({
        units: [uiUnit({ floor })],
        cuid: 'CUID1',
        pid: 'PID1',
      });
      expect(created.units[0].floor).toBe(floor);
      await expect(PropertyUnitValidations.updateUnit.parseAsync({ floor })).resolves.toEqual({
        floor,
      });
    });

    it.each([-5, 101])('rejects floor %i', async (floor) => {
      await expect(PropertyUnitValidations.updateUnit.parseAsync({ floor })).rejects.toThrow();
      await expect(
        PropertyUnitValidations.createUnits.parseAsync({
          units: [uiUnit({ floor })],
          cuid: 'CUID1',
          pid: 'PID1',
        })
      ).rejects.toThrow();
    });
  });

  describe('updateUnitStatus', () => {
    it('accepts a valid status', async () => {
      await expect(
        PropertyUnitValidations.updateUnitStatus.parseAsync({ status: 'maintenance' })
      ).resolves.toEqual({ status: 'maintenance' });
    });

    it('rejects an unknown or missing status', async () => {
      await expect(
        PropertyUnitValidations.updateUnitStatus.parseAsync({ status: 'demolished' })
      ).rejects.toThrow();
      await expect(PropertyUnitValidations.updateUnitStatus.parseAsync({})).rejects.toThrow();
    });
  });

  describe('validatePuid (params)', () => {
    it('keeps the cuid and pid route params alongside puid', async () => {
      mockPropertyUnitDAO.findFirst.mockReturnValue(Promise.resolve({ puid: 'PUID-123' }));

      const parsed = await PropertyUnitValidations.validatePuid.parseAsync({
        cuid: 'CUID1',
        pid: 'PID1',
        puid: 'PUID-123',
      });

      expect(parsed).toEqual({ cuid: 'CUID1', pid: 'PID1', puid: 'PUID-123' });
    });
  });

  describe('inspectUnit', () => {
    it('accepts an inspector object matching the model', async () => {
      const parsed = await PropertyUnitValidations.inspectUnit.parseAsync({
        inspectionDate: '2026-11-01T10:00:00.000Z',
        inspector: { name: 'Jane Inspector', contact: '416-555-1234', company: 'Acme' },
        status: 'scheduled',
      });

      expect(parsed.inspector).toEqual({
        name: 'Jane Inspector',
        contact: '416-555-1234',
        company: 'Acme',
      });
    });

    it('rejects a plain-string inspector or one missing contact', async () => {
      await expect(
        PropertyUnitValidations.inspectUnit.parseAsync({
          inspectionDate: '2026-11-01',
          inspector: 'Jane Inspector',
          status: 'scheduled',
        })
      ).rejects.toThrow();
      await expect(
        PropertyUnitValidations.inspectUnit.parseAsync({
          inspectionDate: '2026-11-01',
          inspector: { name: 'Jane Inspector' },
          status: 'scheduled',
        })
      ).rejects.toThrow();
    });
  });

  describe('rejectUnitChanges', () => {
    it('rejects a blank reason and trims a real one', async () => {
      await expect(
        PropertyUnitValidations.rejectUnitChanges.parseAsync({ reason: '   ' })
      ).rejects.toThrow('Rejection reason is required');
      await expect(
        PropertyUnitValidations.rejectUnitChanges.parseAsync({ reason: '  Too high  ' })
      ).resolves.toEqual({ reason: 'Too high' });
    });
  });
});
