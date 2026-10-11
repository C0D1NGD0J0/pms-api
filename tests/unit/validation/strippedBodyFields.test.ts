import { InspectionType } from '@interfaces/inspection.interface';
import { GuestPassValidations } from '@shared/validations/GuestPassValidation';
import { MaintenanceCategory } from '@interfaces/maintenanceRequest.interface';
import { InspectionValidations } from '@shared/validations/InspectionValidation';
import { updateVendorSchema } from '@shared/validations/VendorValidation/schemas';
import { chargeForMaintenance } from '@shared/validations/PaymentsValidation/schemas';
import { MaintenanceSchemas } from '@shared/validations/MaintenanceRequestValidation/schemas';

// validateRequest replaces req.body with the parsed result, so undeclared keys are stripped.
// These tests pin the fields the services rely on.
jest.mock('@di/setup', () => ({
  container: {
    cradle: {
      propertyDAO: { findFirst: jest.fn().mockResolvedValue({ _id: 'property-id' }) },
      propertyUnitDAO: { findFirst: jest.fn().mockResolvedValue({ _id: 'unit-id' }) },
    },
  },
}));

const futureIso = () => new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

describe('Maintenance request body schemas', () => {
  it('assignmentBody keeps technician.userId', async () => {
    const userId = '507f1f77bcf86cd799439011';
    const result = await MaintenanceSchemas.assignmentBody.parseAsync({
      action: 'accept',
      technician: { name: 'Tech', userId },
    });
    expect(result.technician?.userId).toBe(userId);
  });

  it('assignmentBody rejects a malformed technician.userId', async () => {
    await expect(
      MaintenanceSchemas.assignmentBody.parseAsync({
        action: 'accept',
        technician: { name: 'Tech', userId: 'not-an-id' },
      })
    ).rejects.toThrow('Technician user ID must be a valid ID');
  });

  it('createBody keeps staff-only fields and coerces multipart number strings', async () => {
    const scheduledDate = futureIso();
    const result = await MaintenanceSchemas.createBody.parseAsync({
      pid: 'PID123',
      title: 'Leaking faucet',
      description: { text: 'The faucet has been dripping for days' },
      category: MaintenanceCategory.PLUMBING,
      permissionToEnter: true,
      setMaintenanceStatus: true,
      vendorVuid: 'VUID123',
      scheduledDate,
      estimatedCost: '250.5',
    });

    expect(result).toMatchObject({
      setMaintenanceStatus: true,
      vendorVuid: 'VUID123',
      scheduledDate,
      estimatedCost: 250.5,
    });
  });

  it('createBody rejects a past scheduledDate', async () => {
    await expect(
      MaintenanceSchemas.createBody.parseAsync({
        pid: 'PID123',
        title: 'Leaking faucet',
        description: { text: 'The faucet has been dripping for days' },
        category: MaintenanceCategory.PLUMBING,
        permissionToEnter: true,
        scheduledDate: '2020-01-01T00:00:00.000Z',
      })
    ).rejects.toThrow('Scheduled date must be in the future');
  });

  it('invoiceBody keeps an https attachment', async () => {
    const attachment = { url: 'https://bucket.s3.amazonaws.com/inv.pdf', key: 'inv.pdf' };
    const result = await MaintenanceSchemas.invoiceBody.parseAsync({
      amount: 1000,
      description: 'Repair',
      attachment: { ...attachment, filename: 'inv.pdf' },
    });
    expect(result.attachment).toEqual(attachment);
  });

  it('invoiceBody rejects a non-https attachment URL', async () => {
    await expect(
      MaintenanceSchemas.invoiceBody.parseAsync({
        amount: 1000,
        description: 'Repair',
        attachment: { url: 'javascript:alert(1)', key: 'inv.pdf' },
      })
    ).rejects.toThrow();
  });
});

describe('Inspection body schemas', () => {
  const room = { name: 'Kitchen', condition: 'good' };
  const media = {
    key: 'inspections/abc.jpg',
    url: 'https://bucket.s3.amazonaws.com/inspections/abc.jpg?X-Amz-Signature=x',
    status: 'active',
    filename: 'abc.jpg',
  };

  it('updateBody keeps room media echoed back by the UI', async () => {
    const result = await InspectionValidations.updateBody.parseAsync({
      rooms: [{ ...room, media: [{ ...media, uploadedBy: 'someone' }] }],
      mediaToRemove: [{ roomIndex: 0, mediaIndex: 1 }],
    });
    expect(result.rooms?.[0].media).toEqual([media]);
    expect(result.mediaToRemove).toEqual([{ roomIndex: 0, mediaIndex: 1 }]);
  });

  it('createBody strips room media (new files only arrive as uploads)', async () => {
    const result = await InspectionValidations.createBody.parseAsync({
      type: InspectionType.ROUTINE,
      propertyId: 'PID123',
      scheduledDate: futureIso(),
      rooms: [{ ...room, media: [media] }],
    });
    expect(result.rooms?.[0]).not.toHaveProperty('media');
  });
});

describe('Guest pass createPass schema', () => {
  const base = {
    propertyId: 'PID123ABCDEF',
    visitorName: 'Visitor',
    sendViaSms: true,
    sendViaEmail: false,
    visitorPhone: '+15555550100',
  };

  it('accepts the pid/puid the UI sends and treats blank optional inputs as missing', async () => {
    const result = await GuestPassValidations.createPass.parseAsync({
      ...base,
      unitId: '',
      visitorEmail: '',
    });
    expect(result.propertyId).toBe('PID123ABCDEF');
    expect(result.unitId).toBeUndefined();
    expect(result.visitorEmail).toBeUndefined();
  });

  it('keeps purpose and hostNotes, treating blank values as missing', async () => {
    const result = await GuestPassValidations.createPass.parseAsync({
      ...base,
      purpose: ' Delivery ',
      hostNotes: 'Ring the side door',
    });
    expect(result.purpose).toBe('Delivery');
    expect(result.hostNotes).toBe('Ring the side door');

    const blank = await GuestPassValidations.createPass.parseAsync({
      ...base,
      purpose: '',
      hostNotes: '',
    });
    expect(blank.purpose).toBeUndefined();
    expect(blank.hostNotes).toBeUndefined();
  });

  it('limits hostNotes to 500 characters', async () => {
    await expect(
      GuestPassValidations.createPass.parseAsync({ ...base, hostNotes: 'A'.repeat(501) })
    ).rejects.toThrow();
  });

  it('caps expiryMinutes at the model maximum of 60', async () => {
    await expect(
      GuestPassValidations.createPass.parseAsync({ ...base, expiryMinutes: 90 })
    ).rejects.toThrow();
  });

  it('keeps hostName and hostPhone, treating blank values as missing', async () => {
    const result = await GuestPassValidations.createPass.parseAsync({
      ...base,
      hostName: ' Rita Resident ',
      hostPhone: '+1 (555) 010-0200',
    });
    expect(result.hostName).toBe('Rita Resident');
    expect(result.hostPhone).toBe('+1 (555) 010-0200');

    const blank = await GuestPassValidations.createPass.parseAsync({
      ...base,
      hostName: '',
      hostPhone: '',
    });
    expect(blank.hostName).toBeUndefined();
    expect(blank.hostPhone).toBeUndefined();
  });

  it('rejects a malformed or over-long host phone and an over-long host name', async () => {
    await expect(
      GuestPassValidations.createPass.parseAsync({ ...base, hostPhone: 'call me' })
    ).rejects.toThrow();
    await expect(
      GuestPassValidations.createPass.parseAsync({ ...base, hostPhone: '1'.repeat(21) })
    ).rejects.toThrow();
    await expect(
      GuestPassValidations.createPass.parseAsync({ ...base, hostName: 'A'.repeat(101) })
    ).rejects.toThrow();
  });
});

describe('Vendor update schema', () => {
  it('accepts an address with only fullAddress (the service geocodes the rest)', () => {
    const result = updateVendorSchema.parse({ address: { fullAddress: '1 Main St, Toronto' } });
    expect(result.address).toEqual({ fullAddress: '1 Main St, Toronto' });
  });

  it('still requires fullAddress when an address is sent', () => {
    expect(() => updateVendorSchema.parse({ address: { city: 'Toronto' } })).toThrow();
  });
});

describe('Payments chargeForMaintenance schema', () => {
  it('does not require amount (the service charges the approved invoice amount)', () => {
    const result = chargeForMaintenance.parse({ mruid: 'MR123', tenantId: 'tenant-1' });
    expect(result.amount).toBeUndefined();
  });
});
