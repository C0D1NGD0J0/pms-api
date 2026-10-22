import { sendInvitationSchema } from '@shared/validations/InvitationValidation/schemas';

describe('sendInvitationSchema — linkedVendorUid', () => {
  it('flags a malformed vendor id as corrupted data and names the value', () => {
    const result = sendInvitationSchema
      .pick({ linkedVendorUid: true })
      .safeParse({ linkedVendorUid: 'bad@vendor#id' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe('Corrupted user data detected (bad@vendor#id)');
  });

  it('accepts an omitted vendor id', () => {
    const result = sendInvitationSchema.pick({ linkedVendorUid: true }).safeParse({});

    expect(result.success).toBe(true);
  });
});
