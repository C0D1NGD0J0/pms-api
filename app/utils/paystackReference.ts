import crypto from 'crypto';

/**
 * References the app creates for Paystack charges. Anything without this prefix is Stripe.
 * Paystack only allows letters, digits, '-', '.' and '=' in references.
 */
export const PAYSTACK_REFERENCE_PREFIX = 'psk-';

const REFERENCE_RANDOM_BYTES = 10; // 20 hex characters

/** Matches exactly the references createPaystackReference makes (used to validate input). */
export const PAYSTACK_REFERENCE_PATTERN = new RegExp(
  `^${PAYSTACK_REFERENCE_PREFIX}[a-f0-9]{${REFERENCE_RANDOM_BYTES * 2}}$`
);

export const createPaystackReference = (): string =>
  `${PAYSTACK_REFERENCE_PREFIX}${crypto.randomBytes(REFERENCE_RANDOM_BYTES).toString('hex')}`;
