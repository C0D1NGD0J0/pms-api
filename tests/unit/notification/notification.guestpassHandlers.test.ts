import { Types } from 'mongoose';
import { handleGuestPassCreated } from '@services/notification/notification.guestpass.handlers';

const CUID = 'CLIENT001';
const propertyId = new Types.ObjectId();
const securityGuardId = new Types.ObjectId();
const maintenanceStaffId = new Types.ObjectId();

const staffUsers = [
  { _id: securityGuardId, profile: { employeeInfo: { department: 'security' } } },
  { _id: maintenanceStaffId, profile: { employeeInfo: { department: 'maintenance' } } },
];

const buildCtx = (assignedStaff: Types.ObjectId[]) =>
  ({
    createNotification: jest.fn().mockResolvedValue({ success: true, data: {} }),
    sseService: {
      sendToUser: jest.fn().mockResolvedValue(true),
      broadcastToClient: jest.fn().mockResolvedValue(1),
    },
    propertyDAO: {
      findFirst: jest.fn().mockResolvedValue({ _id: propertyId, name: 'Maple', assignedStaff }),
    },
    userDAO: {
      findFirst: jest.fn(
        async ({ _id }: { _id: Types.ObjectId }) =>
          staffUsers.find((user) => user._id.equals(_id)) ?? null
      ),
    },
    log: { info: jest.fn(), error: jest.fn() },
  }) as any;

const payload = {
  cuid: CUID,
  vpuid: 'VP12345678AB',
  createdBy: new Types.ObjectId().toString(),
  visitorName: 'Visitor',
  propertyId: propertyId.toString(),
};

describe('handleGuestPassCreated live event targeting', () => {
  it('sends the live event only to the security staff assigned to the property', async () => {
    const ctx = buildCtx([securityGuardId, maintenanceStaffId]);

    await handleGuestPassCreated(ctx, payload);

    expect(ctx.sseService.sendToUser).toHaveBeenCalledTimes(1);
    expect(ctx.sseService.sendToUser).toHaveBeenCalledWith(
      securityGuardId.toString(),
      CUID,
      expect.objectContaining({
        resource: 'guestPass',
        action: 'created',
        resourceUId: payload.vpuid,
      }),
      'resource-event'
    );
    expect(ctx.sseService.broadcastToClient).not.toHaveBeenCalled();
    expect(ctx.createNotification).toHaveBeenCalledTimes(1);
    expect(ctx.createNotification.mock.calls[0][2]).toMatchObject({
      recipient: securityGuardId.toString(),
      recipientType: 'individual',
    });
  });

  it.each([
    ['no staff are assigned', []],
    ['only non-security staff are assigned', [maintenanceStaffId]],
  ])(
    'falls back to the account managers, not every security guard, when %s',
    async (_case, assigned) => {
      const ctx = buildCtx(assigned);

      await handleGuestPassCreated(ctx, payload);

      expect(ctx.sseService.sendToUser).not.toHaveBeenCalled();
      expect(ctx.sseService.broadcastToClient).toHaveBeenCalledWith(
        CUID,
        expect.objectContaining({ resource: 'guestPass', resourceUId: payload.vpuid }),
        'resource-event',
        undefined,
        ['super-admin', 'admin', 'manager']
      );
      const announcement = ctx.createNotification.mock.calls[0][2];
      expect(announcement).toMatchObject({
        recipientType: 'announcement',
        targetRoles: ['super-admin', 'admin', 'manager'],
      });
      expect(announcement).not.toHaveProperty('targetDepartments');
    }
  );
});
