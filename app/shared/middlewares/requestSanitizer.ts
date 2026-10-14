import sanitizer from 'perfect-express-sanitizer';

/**
 * XSS filter for request input.
 *
 * The library's NoSQL keyword filter is deliberately off: it strips substrings such as `add`,
 * `1=1`, `==` and `$` with no word boundaries, so "Paddington" became "Pington" and Stripe
 * signatures lost their `v1=`. Operator injection is handled by express-mongo-sanitize, which
 * removes `$`-prefixed and dotted keys — a plain string value can't act as a Mongo operator.
 *
 * Headers are excluded too: they're never rendered or queried, and filtering them corrupted
 * HMAC signature headers (Stripe, BoldSign, Twilio) and JWT cookies.
 */
export const requestSanitizer = sanitizer.clean(
  { xss: true, level: 3 },
  [],
  ['body', 'params', 'query']
);
