import { readPaystackSavedCard } from '@utils/helpers';
import {
  PAYSTACK_REFERENCE_PATTERN,
  PAYSTACK_REFERENCE_PREFIX,
  createPaystackReference,
} from '@utils/paystackReference';

describe('paystackReference', () => {
  it('makes references the validation pattern accepts, using only characters Paystack allows', () => {
    const reference = createPaystackReference();

    expect(reference.startsWith(PAYSTACK_REFERENCE_PREFIX)).toBe(true);
    expect(reference).toMatch(PAYSTACK_REFERENCE_PATTERN);
    expect(reference).toMatch(/^[A-Za-z0-9.=-]+$/);
  });

  it('makes a different reference each time', () => {
    expect(createPaystackReference()).not.toBe(createPaystackReference());
  });

  it.each(['psk_0a1b2c3d4e5f6a7b8c9d', 'psk-0A1B2C3D4E5F6A7B8C9D', 'psk-short', 'pi_123'])(
    'rejects %s',
    (reference) => {
      expect(reference).not.toMatch(PAYSTACK_REFERENCE_PATTERN);
    }
  );
});

describe('readPaystackSavedCard', () => {
  const card = { authorizationCode: 'AUTH_x', brand: 'visa', last4: '4081' } as any;

  it('reads the card for a landlord from a Mongoose Map or a lean object', () => {
    expect(readPaystackSavedCard(new Map([['ACCT_1', card]]), 'ACCT_1')).toBe(card);
    expect(readPaystackSavedCard({ ACCT_1: card }, 'ACCT_1')).toBe(card);
  });

  it('returns undefined when there is no card for that landlord', () => {
    expect(readPaystackSavedCard({ ACCT_1: card }, 'ACCT_2')).toBeUndefined();
    expect(readPaystackSavedCard(undefined, 'ACCT_1')).toBeUndefined();
  });
});
