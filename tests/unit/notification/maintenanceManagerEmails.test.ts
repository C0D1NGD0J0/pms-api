import { Types } from 'mongoose';
import { MailType } from '@interfaces/utils.interface';
import { handleMRDeclined } from '@services/notification/notification.maintenance.handlers';

describe('maintenance emails meant for the property manager', () => {
  const propertyId = new Types.ObjectId();
  const managerId = new Types.ObjectId();
  const adminId = new Types.ObjectId();
  const addToEmailQueue = jest.fn();

  const ctx = (managedBy?: Types.ObjectId) =>
    ({
      createNotification: jest.fn(),
      emailQueue: { addToEmailQueue },
      maintenanceRequestDAO: { getByMruid: jest.fn().mockResolvedValue({ propertyId }) },
      propertyDAO: { findFirst: jest.fn().mockResolvedValue({ managedBy }) },
      clientDAO: { getClientByCuid: jest.fn().mockResolvedValue({ accountAdmin: adminId }) },
      userDAO: {
        findFirst: jest.fn(async ({ _id }) => ({
          email: _id.equals(managerId) ? 'manager@test.com' : 'owner@test.com',
        })),
      },
      log: { error: jest.fn(), info: jest.fn() },
    }) as any;

  beforeEach(() => addToEmailQueue.mockClear());

  it("sends the vendor-declined email to the property's manager", async () => {
    await handleMRDeclined(ctx(managerId), { cuid: 'c1', mruid: 'mr1', vendorId: 'v1' } as any);

    expect(addToEmailQueue).toHaveBeenCalledWith(
      'maintenanceRequestDeclined',
      expect.objectContaining({
        to: 'manager@test.com',
        emailType: MailType.MAINTENANCE_REQUEST_DECLINED,
      })
    );
  });

  it('falls back to the account admin when the property has no manager', async () => {
    await handleMRDeclined(ctx(undefined), { cuid: 'c1', mruid: 'mr1', vendorId: 'v1' } as any);

    expect(addToEmailQueue).toHaveBeenCalledWith(
      'maintenanceRequestDeclined',
      expect.objectContaining({ to: 'owner@test.com' })
    );
  });
});
