import { UserValidations } from '@shared/validations/UserValidation';
import { AuthValidations } from '@shared/validations/AuthValidation';

describe('email change validation', () => {
  it('normalises the requested address', async () => {
    const parsed = await UserValidations.emailChangeRequest.parseAsync({
      newEmail: '  New.Person@Example.COM ',
    });
    expect(parsed).toEqual({ newEmail: 'new.person@example.com' });
  });

  it('rejects a malformed address', async () => {
    const result = await UserValidations.emailChangeRequest.safeParseAsync({ newEmail: 'nope' });
    expect(result.success).toBe(false);
  });

  it('strips undeclared body fields', async () => {
    const parsed = await UserValidations.emailChangeRequest.parseAsync({
      newEmail: 'a@b.co',
      email: 'other@b.co',
    });
    expect(parsed).toEqual({ newEmail: 'a@b.co' });
  });

  it('accepts only a 64-char hex confirmation token', async () => {
    const token = 'a'.repeat(64);
    await expect(AuthValidations.emailChangeToken.parseAsync({ t: token })).resolves.toEqual({
      t: token,
    });
    const tooShort = await AuthValidations.emailChangeToken.safeParseAsync({ t: 'abc' });
    const notHex = await AuthValidations.emailChangeToken.safeParseAsync({ t: 'z'.repeat(64) });
    expect(tooShort.success).toBe(false);
    expect(notHex.success).toBe(false);
  });
});
